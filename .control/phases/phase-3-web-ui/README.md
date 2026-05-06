# Phase 3 — web-ui

**Dependencies:** Phase 2 (`phase-2-channel-parity-closed`)
**Estimated duration:** ~2-3 sessions

## Goal

Web UI uses real Astro components, has live updates via SSE, has a chat surface, and is mobile-responsive. Vanilla DOM-in-Astro becomes proper Astro + (optional) Solid/Preact islands.

## Outcome

- Kicking off a build from the dashboard streams task / finding / spend / log updates live without page refresh.
- A `/app/chat` page mirrors `factory chat` in the browser end-to-end.
- A `/app/projects/new` page mirrors `factory init` for a single project.
- Cancel and pause buttons on directive detail page.
- Spend page renders sparkline-per-project + 30-day stacked bar.
- Mobile-responsive nav (hamburger drawer at narrow widths).
- Explicit logout + a "Connected to factory5" status indicator in the header.
- All 9 pages converted to use the Astro component library; `el()` retired from `lib/api.ts`.
- All four `pnpm` gates clean; `apps/factory-web` builds clean.

## Where we were, end of Phase 2

Carried forward from Phase 2:
- Step 2.6 — `factory chat` per-turn timeout (cheap path: bump `TURN_TIMEOUT_MS` to 600s; better path: stream partial daemon-side progress). Deferred to Phase 3 because the streaming/SSE work that ships with the web-UI uplift naturally subsumes the better path; landing the 120s→600s bump now would be a throwaway change that's reverted as soon as streaming arrives.

Phase 2 shipped Discord + Telegram channel parity (slash commands, setMyCommands, button affordances on pending-question messages), `factory cancel <id>` end-to-end (brain AbortController registry through to worker SIGTERM/SIGKILL discipline + worktree-cleanup `cancelled` outcome), and 8-intent triage classification with channel handlers re-routing chat-shaped reads. The shared `command-handlers.ts` module from 2.2 is the reuse anchor — Phase 3's `/app/chat` page can call into the same handler set if/when it dispatches read commands rather than free-form LLM chat.

## Why this phase exists

Carried forward from Phase 2:
- Step 2.6 — `factory chat` per-turn timeout (cheap path: bump `TURN_TIMEOUT_MS` to 600s; better path: stream partial daemon-side progress). Deferred to Phase 3 because the streaming/SSE work that ships with the web-UI uplift naturally subsumes the better path; landing the 120s→600s bump now would be a throwaway change that's reverted as soon as streaming arrives.

The web UI is the third operating surface (after CLI and channels), and today it's the weakest: a mix of Astro pages and ad-hoc DOM-builders (`el()` in `lib/api.ts`), no live updates (you have to F5), no chat, no `factory init` analogue, no spend visualisations. Operators on a desktop can do everything from the CLI faster than from the dashboard. Phase 3 fixes that. It's also the natural home for SSE streaming, which Step 2.6 carries forward — the streaming infra is a `factory chat` quality fix in addition to a dashboard live-updates feature.

Issues addressed: U006 (no live updates), U007 (DOM-builder pattern), U008 (no `/app/chat`), U009 (no spend charts), U010 (no mobile nav), U022 (no explicit logout / connection indicator).

## Steps

See [`steps.md`](steps.md) for the detailed checklist.

Full implementation plan (richer than the steps below — file pointers, acceptance criteria per sub-task, decision rationale, suggested commit messages): [`../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md).

## Done criteria

All must be verified before `/phase-close` advances:

- [ ] All items in `steps.md` checked off, each with a commit reference
- [ ] `.control/issues/OPEN/` contains no items tagged `phase:3-blocker`
- [ ] `pnpm build` ✅ · `pnpm test` ✅ · `pnpm lint` ✅ · `pnpm format:check` ✅
- [ ] `apps/factory-web` builds clean (`pnpm --filter factory-web build`)
- [ ] Issues U006, U007, U008, U009, U010, U022 marked Resolved in [`../../../UPGRADE/ISSUES.md`](../../../UPGRADE/ISSUES.md)
- [ ] Live build smoke: kicking off a build from `/app` shows task, finding, spend, and log updates streaming into the directive-detail page without F5
- [ ] `/app/chat` round-trips to the daemon end-to-end against a real factoryd
- [ ] `/app/projects/new` scaffolds a project end-to-end matching `factory init <project>`
- [ ] Cancel button on directive-detail kills the worker (verified by reusing Phase 2's cancel route)
- [ ] Mobile nav functional at 375px (hamburger drawer; primary actions reachable in two taps)
- [ ] All 9 existing pages converted to Astro components; `el()` removed from `lib/api.ts`
- [ ] Working tree clean (`git status` shows nothing to commit)
- [ ] All commits follow `<type>(3.<step>): <subject>` shape (e.g. `feat(3.1): SSE on /api/v1/directives/:id/stream`)
- [ ] Phase will be tagged `phase-3-web-ui-closed` by `/phase-close`

## Rollback plan

If Phase 3 needs to be undone: `git reset --hard phase-2-channel-parity-closed`. No external state to roll back — SSE is a Fastify route addition, the new pages are file-additions under `apps/factory-web/src/pages/`. The Astro component library lives under `apps/factory-web/src/components/` and is internal to the SPA; it disappears with the reset.

## ADRs decided in this phase

- **ADR 0027** — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`).
- **ADR 0028** — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn).
- **ADR 0029** — directive-stream-protocol (SSE for live build observation, six event types, brain-side optional-callback emission). Live-verification gap for `finding.created` was closed in 3.7's smoke; structural promotion past gated state landed at `/phase-close`.

## Deferred to Phase 4 (or later)

<!-- Items that surface during this phase's work but exceed scope.
One-line reason per item. Copy forward into the next phase's
"Why this phase exists" section when it activates. -->

- Pause primitive on directive detail — defer until a real workflow signal demands it (cancel solves the primary operator-pain case; pause-then-think is the kind of feature worth designing once; choose between extending `directivesQ.status` with `paused`/resume or reusing `markBlocked` with `blockedReason: 'paused-by-operator'` when the signal lands).
- PageShell adoption + Dashboard `<style is:global>` migration — 11-page structural sweep that absorbs the unstyled "Clear all defaults" + 4× filter-form Apply buttons issue, consolidates inline `style=` attributes, and moves Dashboard's currently-scoped `.btn*` / `.alert*` / `.form-*` rules to global so raw page buttons inherit them; self-contained ~1 commit when authored.
- Brain-side `log.line` forwarder — selective pino-stream tap filtered by `correlationId` so the FE log tail uses live events instead of the polling fallback (ADR 0029 future-work item; not gating any 4.x step but a natural fit alongside the CLI-completion polish).
