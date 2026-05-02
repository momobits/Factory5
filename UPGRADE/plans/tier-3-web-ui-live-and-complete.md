# Tier 3 — Web UI live and complete

**Goal**: Web UI uses real Astro components, has live updates via SSE, has a chat surface, and is mobile-responsive. Vanilla DOM-in-Astro becomes proper Astro + (optionally) Solid/Preact islands.

**Why this tier**: the user described the web UI as _"very basic and issue prone"_ — closing every gap on that surface in one tier.

**Estimated effort**: 2-3 sessions. Suggested split:

- Session 3a: SSE backend + directive detail page wired to it + cancel button.
- Session 3b: Astro component library + page conversion + chat page.
- Session 3c: New project page + spend charts + mobile nav + token UX.

**Issues addressed**: U006, U007, U008, U009, U010, U022.

---

## Pre-requisites

Read before starting:

- [`../AUDIT.md`](../AUDIT.md) §1 (web UI gaps)
- ADR 0025 (web UI architecture), ADR 0027 (web UI mutation surface)
- `apps/factory-web/src/lib/api.ts` — current `el()` helper + token + apiFetch/apiPost/apiPut
- `apps/factory-web/src/layouts/Dashboard.astro` — current layout (also has all the CSS)
- `apps/factory-web/src/pages/directives/detail.astro` — most-active page; SSE will land first here
- `packages/daemon/src/server.ts` — Fastify routes; SSE will be added here
- `packages/ipc/src/schemas.ts` — Zod schemas for response shapes
- Tier 2 plan, especially 2.4 (cancel plumbing) — Tier 3 depends on it for the cancel button

Verify all four gates pass before starting.

---

## Sub-tasks

### 3.1 SSE on `/api/v1/directives/:id/stream`

**Goal**: a per-directive event stream that the web UI subscribes to for live tasks/findings/spend/log updates.

**Spec**: write `specs/sse-directive-stream.md` first. Pin event shapes:

```
event: task.started
data: { taskId, title, agent, category, startedAt }

event: task.completed
data: { taskId, status, finishedAt, error? }

event: finding.created
data: { findingId, severity, status, target, description }

event: spend.updated
data: { totalCostUsd, callCount, deltaUsd }

event: log.line
data: { ts, level, component, msg, attrs }

event: directive.completed
data: { directiveId, status, blockedReason? }
```

NDJSON-over-SSE; each event has `event:` and `data:` lines per the SSE spec.

**Backend wiring**:

1. New route: `GET /api/v1/directives/:id/stream` in `packages/daemon/src/server.ts`. Returns SSE (`Content-Type: text/event-stream`).

2. **Per-directive event bus**: in-memory hub in factoryd. The brain emits structured events into this hub at every state transition (already logged today; we need the _structured_ version, not just log lines). The SSE handler subscribes to the hub.

3. **Backfill on connect**: when a client subscribes, replay the directive's terminal events from SQLite (existing tasks, findings, spend) before switching to live. Avoids missing events for clients that connect after the build started.

4. **Heartbeats**: send a `:keepalive\n\n` comment line every 15s to keep proxies from killing the connection.

5. **Auth**: same `FACTORY5_UI_TOKEN` bearer as the rest of `/api/v1/*`. SSE clients can pass via `?t=<token>` query param (EventSource doesn't support custom headers directly).

**File pointers**:

- New: `UPGRADE/specs/sse-directive-stream.md` — pin the event shapes.
- New: `packages/daemon/src/directive-stream.ts` — in-memory hub.
- Edit: `packages/daemon/src/server.ts` — `/api/v1/directives/:id/stream` route.
- Edit: `packages/brain/src/loop.ts` (and similar) — emit structured events into the hub at state transitions.
- Edit: `packages/ipc/src/schemas.ts` — add the SSE event Zod schemas.

**Acceptance**: `curl -N http://127.0.0.1:25295/api/v1/directives/<id>/stream?t=<token>` produces a live event stream during a build; events are well-formed; client disconnect doesn't crash factoryd.

### 3.2 Wire directive detail page to SSE

**Replace** the one-shot `loadInto<Detail>` call with an `EventSource` subscription. Render: tasks table grows live, findings list grows live, spend ticker updates, log tail panel scrolls.

**UI affordances**:

- Auto-scroll log tail; pause when user scrolls up; resume button when out-of-pin.
- Connection-state indicator: "Live", "Reconnecting", "Disconnected".
- On `directive.completed`, stop showing the live indicator; show the final status prominently.

**File pointers**:

- Edit: `apps/factory-web/src/pages/directives/detail.astro` — switch fetch model.
- Edit: `apps/factory-web/src/lib/api.ts` — add `apiStream<T>(path)` helper that wraps EventSource with token-auth + reconnect.

**Acceptance**: kick off a build, open directive detail in a second tab, see live updates without reloading.

### 3.3 Cancel button on directive detail

**Depends on Tier 2.4 (cancel plumbing).** Once that's shipped, add a "Cancel build" button to the directive detail page.

- Visible only when directive is `running` or `pending`.
- Calls `apiPost('/api/v1/directives/:id/cancel', {})` (Tier 2 IPC route).
- Disables on click; shows "Cancelling..." until SSE reports `directive.completed`.

**File pointers**:

- Edit: `apps/factory-web/src/pages/directives/detail.astro` — button + handler.
- Edit: `packages/daemon/src/server.ts` — confirm the cancel route is mounted under `/api/v1/*` (Tier 2 will likely have it under `/directives/:id/cancel`; double-check the prefix).

**Acceptance**: click cancel, see status flip to `failed` within a few seconds, see workers terminate.

### 3.4 Astro component library

**Build a small set of reusable components** under `apps/factory-web/src/components/`:

| Component                       | Props                                                              | Replaces                          |
| ------------------------------- | ------------------------------------------------------------------ | --------------------------------- |
| `<Card title value/>`           | `title`, `value`, `unit?`, `trend?`                                | overview cards                    |
| `<Table columns rows/>`         | `columns: {key,label,align?}[]`, `rows: object[]`, `emptyMessage?` | every table                       |
| `<EmptyState title body cta?/>` | `title`, `body`, `cta?: {label, href}`                             | empty messaging                   |
| `<Alert kind title body/>`      | `kind: 'info' \| 'success' \| 'conflict'`, `title`, `body`         | error/conflict alerts             |
| `<Form>`, `<Field>`, `<Submit>` | composable form primitives                                         | the build/budget forms            |
| `<PageShell title>`             | `title`, slot                                                      | thin layout above page content    |
| `<StatusPill status/>`          | `status: string`                                                   | the inline status text everywhere |

CSS lives with each component (scoped Astro `<style>`), not in the layout. The current monolithic `Dashboard.astro` style block is broken up.

**Migration strategy**: convert pages one at a time; both patterns coexist during the migration; retire `el()` only after every page is converted.

**Optional Solid/Preact island per page** — only where a page genuinely needs reactive state (chat, directive detail with SSE, build form). The rest can be static Astro + light vanilla JS.

**File pointers**:

- New: `apps/factory-web/src/components/{Card,Table,EmptyState,Alert,Form,Field,Submit,PageShell,StatusPill}.astro`.
- Edit: each page in `apps/factory-web/src/pages/` — convert one at a time.
- Eventually delete: the `el()` helper from `apps/factory-web/src/lib/api.ts`.

**Acceptance**: every page uses the component library; `el()` no longer exists; visual regression smoke tests show the UI looks the same or better.

### 3.5 `/app/chat` page

**A web mirror of `factory chat`**. Operator types a message; web posts to a new `POST /api/v1/chat/messages` endpoint that creates an `intent=chat` directive; the page subscribes to the directive's SSE stream for the reply (one outbound `log.line` event per agent message, basically).

**UX**:

- History pane (vertical list of "you said X" / "factory replied Y").
- Markdown rendering for replies (use a tiny markdown lib like `marked` or hand-roll the basics).
- Auto-scroll to bottom on new message; pause on user scroll.
- Optional: `/cmd` shortcuts (the same set as Tier 2 channel commands) — if the message starts with `/`, dispatch to the relevant `command-handlers.ts` shared module instead of going through the chat-intent path. Keeps web UI in parity with chat surfaces.

**File pointers**:

- New: `apps/factory-web/src/pages/chat.astro`.
- Edit: `packages/daemon/src/server.ts` — `POST /api/v1/chat/messages` route.
- Edit: `packages/ipc/src/schemas.ts` — request/response shapes.
- Reuse: `packages/channels/src/command-handlers.ts` from Tier 2.

**Acceptance**: chat from the browser works end-to-end against a running brain.

### 3.6 `/app/projects/new` page

**Mirror `factory init` for a single project** (not the global instance config — that stays CLI-only).

Form fields: project name, language, optional CLAUDE.md textarea, optional budget defaults.

**Backend**:

- New `POST /api/v1/projects` route.
- Creates `<workspace>/<name>/` with `.factory/project.json` populated, optional `CLAUDE.md` written from the textarea.
- Returns the created project metadata.

**File pointers**:

- New: `apps/factory-web/src/pages/projects/new.astro`.
- Edit: `packages/daemon/src/server.ts` — route handler.
- Reuse: project-creation logic from `packages/cli/src/commands/init.ts` (extract a transport-agnostic helper).

**Acceptance**: create a project from the browser; it shows up in the project list; `factory build <name>` works against it without further setup.

### 3.7 Spend page charts

Add a small chart on the spend page:

- Sparkline per project (last 30 days).
- Daily stacked bar (last 30 days, stacked by model category).

Use a tiny charting lib (e.g. `chart.js` light build, or hand-rolled SVG). Avoid heavy deps.

**File pointers**:

- Edit: `apps/factory-web/src/pages/spend/index.astro`.
- Possibly new: `apps/factory-web/src/components/SparklineChart.astro` if needed.
- Possibly new: `apps/factory-web/src/components/StackedBarChart.astro`.

**Acceptance**: spend page has a visual summary; numbers tally with the existing table.

### 3.8 Mobile-responsive nav

At narrow widths (< 700 px), collapse the nav into a hamburger drawer. Form rows stack vertically. Tables become cards (each row is a card with key:value pairs) for the smallest widths if it makes sense.

**File pointers**:

- Edit: `apps/factory-web/src/layouts/Dashboard.astro` (now `<PageShell>` per 3.4) — add media queries.
- Possibly new: `apps/factory-web/src/components/Nav.astro` — handles desktop and mobile rendering.

**Acceptance**: at 375 px width, navigation is reachable; forms aren't horizontally scrolled.

### 3.9 Logout + connection-status indicator

**Logout button** in the header — calls `clearToken()` from `lib/api.ts`, redirects to `/app/?logged-out=1` showing a "Signed out — reopen the URL logged by factoryd to sign in" banner.

**Connection-status indicator** — small strip in the header showing "Connected to factory5" (green) or "Disconnected" (red). Driven by polling `/api/v1/status` once per minute.

**Optional `factory ui-token --rotate`** — a CLI command that mints a new token (invalidating prior sessions). Useful when an operator suspects token leakage. (This is small Tier 4 work but pairs with 3.9 since the rotated token would force re-login.)

**File pointers**:

- Edit: `apps/factory-web/src/layouts/Dashboard.astro` (or `<PageShell>`) — add header strip.
- Edit: `apps/factory-web/src/lib/api.ts` — add `apiStatus()` poll helper.
- Optional: `packages/cli/src/commands/ui-token.ts` — `--rotate` flag.

**Acceptance**: logout works; status indicator shows live connection state.

---

## Acceptance criteria for the whole tier

- All four `pnpm` gates pass.
- `apps/factory-web` builds clean.
- Manual smoke against a real `factoryd` (docs/ONBOARDING.md style):
  - Submit a build, watch tasks/findings/spend update live without refresh.
  - Cancel a running build via the button; see workers terminate.
  - Hold a chat session in `/app/chat`.
  - Create a new project via `/app/projects/new`.
  - Resize browser to 375 px; nav still works.
- All issues U006-U010, U022 marked Resolved.
- Append session entries to [`../LOG.md`](../LOG.md).
- Tick Tier 3 checkboxes in [`../ROADMAP.md`](../ROADMAP.md).

---

## Risks + decisions

- **SSE vs WebSocket**: SSE is simpler (one-way, HTTP, cleaner Fastify integration via `@fastify/sse-v2`). WebSocket is more flexible but overkill for this use case. Recommendation: SSE.
- **Astro + island choice**: Solid/Preact island per page is optional. If Astro static + vanilla `<script>` works for the chat page (it can — EventSource + DOM manipulation is fine), stick with Astro-only. Solid only if multi-state widgets get unwieldy.
- **Markdown lib**: `marked` is ~25KB. `markdown-it` is more featureful but larger. Hand-rolling the subset (bold, italic, code, code-block, link, list) is ~50 LOC if you're only rendering server-trusted content. Pick based on whether you trust the daemon-rendered content (you do — same trust boundary as the rest of the API).
- **Chart lib**: `chart.js` is ~60KB minified. Hand-rolled SVG sparklines are ~30 LOC. Pick based on how much polish you want; the existing aesthetic is utilitarian, so hand-rolled is consistent.
- **Token in URL for SSE** — the only way to auth EventSource without custom headers. Acceptable for a loopback-only daemon (the URL is in the same origin as the page). The page strips `?t=` from the visible URL via `history.replaceState`.

---

## Specs to write

- `UPGRADE/specs/sse-directive-stream.md` — event shapes (3.1).
- `UPGRADE/specs/web-chat-protocol.md` — `POST /api/v1/chat/messages` request/response, SSE binding (3.5).
- `UPGRADE/specs/web-projects-create.md` — `POST /api/v1/projects` request/response (3.6).

When any of these graduate to long-term contracts (likely SSE), promote to ADRs:

- ADR 0029 — directive event-stream protocol (built on `specs/sse-directive-stream.md`).

---

## Suggested commit shape

Several commits, one per 3.x:

1. `feat(daemon,brain): SSE on /api/v1/directives/:id/stream`
2. `feat(web): live updates on directive detail via SSE`
3. `feat(web): cancel button on directive detail`
4. `refactor(web): introduce Astro component library; retire el() helper`
5. `feat(web): /app/chat page`
6. `feat(daemon,web): /app/projects/new + POST /api/v1/projects`
7. `feat(web): spend page charts`
8. `feat(web): mobile-responsive nav + logout + connection indicator`
