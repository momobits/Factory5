# Next session kickoff

> Auto-generated from `.control/progress/STATE.md` at 2026-05-03T16:16:21Z by
> `.claude/hooks/regenerate-next-md.sh`. Edit STATE.md's "Next action"
> or "Notes for next session" to influence this prompt; **do not edit
> next.md by hand** -- it's overwritten on every session end.

This is a Control-managed project. Bootstrap protocol:

1. Read `.control/progress/STATE.md` -- the single source of truth.
2. Read the current phase's `README.md` and `steps.md` (path in STATE.md).
3. Check `.control/issues/OPEN/` for current-phase blockers.

If the SessionStart hook is installed, steps 1-3 run automatically and you
see a structured `[control:state]` block instead of doing them by hand.

## Next action

Open [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.7 = `/app/projects/new` — mirror of `factory init <project>` for a single project** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.7. Form mirrors `factory init`'s flags (language picker, optional `CLAUDE.md` upload, `--max-usd` / `--max-steps` budgets). On submit, scaffold the project via the existing init path; the new project shows up in `/app/projects` and is kickoff-able from `/app/build`. File pointers: new page at `apps/factory-web/src/pages/projects/new.astro` (modeled on `apps/factory-web/src/pages/build.astro`'s `<Form>` + `<Field>` + `<Submit>` shape from 3.4 commit `58d4584`); reuse the daemon's existing project-init route or add a new `POST /api/v1/projects` route gated by `requireUiAuth` (mirrors the 3.6 cancel-route pattern in `packages/daemon/src/server.ts`). Acceptance: form submit creates `<workspace>/<project>/.factory/project.json` end-to-end, project appears at `/app/projects`, and a follow-up build directive succeeds against it. Frontend-design skill required before authoring per saved feedback. Before starting 3.7, consider whether to slot the **operator-pinned live-smoke** in first — it covers 3.6 acceptance + the chat page + ADR 0029 promotion gate in one factoryd-up window (see "3.x backlog" below).

## Notes for next session

Step 3.7 is the `/app/projects/new` page — browser mirror of `factory init <project>`. Per [`../phases/phase-3-web-ui/steps.md`](../phases/phase-3-web-ui/steps.md) line 9 and [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.7.

**Two design decisions to resolve before code, in order:**

1. **Live-smoke first?** All five SSE event types now flow end-to-end (3.1b shipped `finding.created` emission this session); both detail-page and chat-page consumers are wired; 3.6's cancel button needs a single live-smoke against a running factoryd to close acceptance. The smoke also unblocks ADR 0029 promotion. Doing it before 3.7 means 3.7 is built on a verified base; doing it after means a longer rollback path if the smoke surfaces a wire issue. **Recommendation:** smoke first — kick off `factory build <project>`, open `/app/directives/detail?id=<id>`, click cancel, watch worker terminate; click-test `/app/chat` in the same window. ~5 minutes of operator time. If clean: promote ADR 0029, then start 3.7. If issues surface: fix before 3.7.

2. **3.7 form-submit route — reuse or add?** The existing daemon may already have a project-init route (used by the CLI's `factory init`); if so, the FE can call it directly. If not, a new `POST /api/v1/projects` route gated by `requireUiAuth` mirrors the 3.6 cancel pattern (one shared handler, two route prefixes — CLI-facing + SPA-facing). Grep `packages/daemon/src/server.ts` and `packages/cli/src/commands/init.ts` to confirm before designing. The pattern is the same as 3.6's: extract a closure-scoped helper, register it under both prefixes when the CLI hits it via HTTP, register it under just `/api/v1/*` if the CLI uses a non-HTTP path.

**File pointers for 3.7:**

- New page: `apps/factory-web/src/pages/projects/new.astro` — modeled on `apps/factory-web/src/pages/build.astro`'s `<Form>` + `<Field>` + `<Submit>` shape (3.4 commit `58d4584`). Fields: project name (required), language picker (`python` / `node` / `go` / `rust` / `(use server default)`), optional `CLAUDE.md` textarea, optional `--max-usd` / `--max-steps` numeric inputs. On submit: `apiPost('/api/v1/projects', ...)`, redirect to `/app/projects/detail?id=<new-id>` on success or surface inline `<Alert kind="conflict">` on failure (same hidden-Alert-placeholder pattern used by build.astro).
- Form schema: `packages/ipc/src/schemas.ts` — add `apiV1CreateProjectRequestSchema` + `apiV1CreateProjectResponseSchema`. Mirror the existing `apiV1CreateBuildRequestSchema` shape.
- Daemon route: `packages/daemon/src/server.ts` — new `POST /api/v1/projects` (and possibly `/projects` for CLI parity). The handler delegates to whatever `factory init` runs server-side today (likely a function in `@factory5/wiki` or `@factory5/state`).
- CLI parity check: `packages/cli/src/commands/init.ts` — confirm whether init goes through HTTP or DB-direct, mirroring how the 3.6 cancel-route audit confirmed CLI cancel uses HTTP via `cancelDirective` daemon-client.
- Frontend-design skill required before authoring per saved feedback.

**Acceptance:** form submit at `/app/projects/new` creates `<workspace>/<project>/.factory/project.json` and the matching DB row; the project appears in `/app/projects`; a follow-up build directive at `/app/build` succeeds against the new project end-to-end (live-smoke against a real factoryd).

**3.x backlog still open (no 3.7 acceptance dependency, in `phase-3-web-ui/steps.md` "Deferred follow-ups"):**

- **PageShell + Dashboard `<style is:global>` migration** — 11-page structural sweep. **Land in a session where you can spot-check pages in a browser as they convert** — autonomous-only is the wrong fit because the layout's scoped-CSS rules (`.cards`, `.empty`, `.err`, `.btn*`, `.alert*`, `.form-*`, table-base) are currently inert against slot content; flipping to global will start applying them, which can shift layouts the component-level scoped CSS isn't compensating for. Self-contained ~1 commit when run by hand.
- **Pause primitive** — design when a workflow signal demands it. Option A (status-enum extension) vs Option B (`markBlocked` reuse) vs longer-term-defer.
- **Pre-3.5 baseline live-smoke against running factoryd** — gates ADR 0029 promotion. Combined with the 3.6 cancel acceptance smoke into one factoryd-up window per Decision 1's recommendation above.

**Loose ends from prior sessions (still open; not blocking 3.7):**

- Synthetic smoke directive in DB (`01KQPDMQE6QTQZ3QMDD69019YK`, status=failed/cancelled) plus a synthetic project (`demo-project`) and its linked directive. Reap with `cd packages/state && node smoke-cleanup.mjs` if you want a clean `factory status`.
- factoryd PID 32436 from prior session may still be running. `factory daemon stop` shuts it down.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
