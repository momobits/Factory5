# 0025 — Web UI architecture: Astro MPA + ViewTransitions, `FACTORY5_UI_TOKEN` bearer, `/app` static + `/api/v1/*` gated

- **Status:** Accepted
- **Date:** 2026-04-23
- **Builds on:** [ADR 0012](0012-brain-in-factoryd-process.md) — `factoryd` already owns a Fastify server on `127.0.0.1:25295`. [ADR 0014](0014-cli-rpc-transport.md) — HTTP + SQLite-polling is the CLI's existing pattern for daemon↔client read/write. [ADR 0024](0024-worker-subprocess-ask-user.md) §3 — per-startup bearer tokens mounted under a namespaced route prefix.

## Context

Phase 8 closed the worker-subprocess `ask_user` loop (ADR 0024). That work made `pending_questions` a first-class operator-facing surface: builders ask the operator mid-stream, answers come back over Discord/Telegram/CLI, and a single `factory status` poll now underreports what the operator should see. Phase 9's charter (`.control/phases/phase-9-web-ui/README.md`) responds by adding a browser dashboard that surfaces directives, pending questions, spend, and findings at a glance, served off the same Fastify instance factoryd already runs.

The charter narrows the open architectural decisions to four — framework, auth, bundle serving, routing — and defers the sub-step-level "how" to the individual session bodies. This ADR pins those four so 9.2–9.10 implement against a fixed contract, mirroring the way ADR 0024 pinned five sub-decisions before 8.2–8.7 began implementing.

factoryd's Fastify already enforces a localhost-only bind + preHandler (ADR 0012; `packages/daemon/src/server.ts:52`). The `/worker/*` namespace is additionally bearer-gated with a per-startup 48-hex-char token minted in `apps/factoryd/src/main.ts:96` and threaded through `DaemonOptions.workerAuthToken`. Any new public-facing surface should compose with those primitives rather than fork them.

Constraints entering this ADR:

1. **One process, one port.** Phase 9 does not split factoryd. The dashboard lives at `http://127.0.0.1:25295/app/`; the JSON API lives at `http://127.0.0.1:25295/api/v1/*`. No reverse proxy, no certificates, no CORS for production operators.
2. **Read-only in 9a.** Sub-phase 9b will add mutations (answer a pending question, start a build); 9a ships the read side first (directives, pending questions, spend, findings). The auth shape must support both — read-only 9a must not lock us out of a clean 9b write-endpoint design.
3. **No new transport.** HTTP + JSON is what the CLI and workers already speak. SSE/WebSockets are explicitly deferred (same reasoning ADR 0014 applied to CLI-RPC: polling is cheap on localhost; SSE is additive when a live-typing feel becomes load-bearing).
4. **Operator dev-loop must work.** Whatever framework lands must have a hot-reload dev server (`pnpm dev --filter factory-web`) and a build output we can drop behind Fastify static serve. No custom bundler pipeline.

## Decision

Four parts, one ADR.

### 1. Framework: Astro, MPA + Islands, with `<ViewTransitions />`

`apps/factory-web/` is an Astro app. Astro's MPA model (one HTML file per page, file-based routing under `src/pages/`) matches the dashboard's read-only shape: each page fetches its data on load via a client-side `fetch('/api/v1/...')`, no cross-page shared state to manage. `<ViewTransitions />` on the root layout gives cross-page transitions that _feel_ SPA-ish (no full reload flash) without adopting SPA-framework state plumbing. Islands (`client:load` / `client:visible`) stay available for any interactive widgets 9b wires.

Concretely:

- **Build output:** `apps/factory-web/dist/` contains static HTML/CSS/JS ready to serve. Astro's build is Vite-driven; TypeScript is first-class.
- **Dev server:** `pnpm dev --filter factory-web` runs Astro's Vite dev server on `:4321` with HMR. A Vite proxy rule in `astro.config.mjs` rewrites `/api/v1` → `http://127.0.0.1:25295` so dev-mode fetches reach factoryd without CORS.
- **Islands, not SPA shell:** each page is a self-contained HTML document. Shared header/footer lives in `src/layouts/Dashboard.astro`. Data-fetching is `<script>` tags per page (or extracted to `src/lib/api.ts` once there are three copies).

Astro pays for itself over the alternatives on three axes: bundle size (zero JS per page unless opted in via Islands; Vite+React ships ~44 KB min+gz of React alone for a read-only grid), dev-loop ergonomics (Vite HMR is table-stakes; lit-html/vanilla needs a hand-rolled build), and operator-expectation alignment (Astro is the rising default in the ecosystem factory5 targets; a dev reading our code in 2027 will recognise it). Costs: one new toolchain dependency (`astro`, `@astrojs/*`) and the need to learn Astro's `.astro` template syntax — small and contained.

**Styling is out of ADR scope.** Pick at 9.8: either Tailwind (if the page count climbs) or hand-written CSS modules (if it stays small). Neither decision is architectural.

### 2. Auth: separate `FACTORY5_UI_TOKEN`, rotated per startup, distributed via query-param-to-sessionStorage

Mint a new 48-hex-char token at factoryd startup in `apps/factoryd/src/main.ts`, alongside the existing `FACTORY5_WORKER_AUTH_TOKEN` (`randomBytes(24).toString('hex')`, same pattern). Export it on `process.env['FACTORY5_UI_TOKEN']` and thread it into `DaemonOptions.uiAuthToken`.

**Scope separation** — not a merged token:

- `FACTORY5_WORKER_AUTH_TOKEN` gates `/worker/*`. The only caller is the brain's worker subprocesses via the MCP route (ADR 0024). Leaked token → attacker can answer ask-user prompts on the brain's behalf (bad, mitigated by loopback bind).
- `FACTORY5_UI_TOKEN` gates `/api/v1/*`. The only caller is the browser tab the operator opened. Leaked token → attacker can read directives/findings/spend (read-only in 9a). Scoping them separately means a compromise of one (e.g. a rogue browser extension slurps sessionStorage) does not grant worker-impersonation privileges.

**Distribution UX (paste-into-browser):**

1. On successful daemon boot, factoryd logs one line to stdout: `ui: http://127.0.0.1:25295/app/?t=<48-hex>`. Operator clicks or copy-pastes.
2. The SPA shell (`/app/index.html`) reads `?t=` on first load, stores it in `sessionStorage['factory5.ui-token']`, and `history.replaceState`s the bare URL (strips the query so a shoulder-surf of the URL bar shows just `/app/`).
3. Subsequent `/api/v1/*` requests read the token from `sessionStorage` and send `Authorization: Bearer <token>`. Missing-or-stale token renders a "paste token" form instead of a 401 rabbit hole.
4. Recovery: `factory ui-token` prints the current token (CLI hits a new loopback `/ui-token` IPC route whose auth is the existing localhost preHandler). Same Jupyter-style pattern operators already know; survives closed terminals and shell sessions.

The `/api/v1/*` bearer check reuses the existing `checkWorkerBearer` constant-time compare (`packages/daemon/src/server.ts:355`), generalised to a `checkBearer(request, expected)` helper against either token. Token rotation on each startup means a leaked token dies with the daemon; no long-lived secrets to rotate by hand.

**`/app/*` (the static shell) is not bearer-gated.** The HTML/JS/CSS files reveal nothing — same bundle for every operator. Only `/api/v1/*` returns operator data. This mirrors every modern dashboard-with-auth pattern (Grafana, Jupyter, Kibana): static shell open, data API gated.

**Rejected alternatives** (expanded in §Alternatives below): reusing `FACTORY5_WORKER_AUTH_TOKEN` (scope creep); no auth at all ("loopback is enough"); browser-based OIDC / session cookies (way too heavy for a dev tool).

### 3. Bundle serving: `@fastify/static` in prod; Astro dev server + Vite proxy in dev

`DaemonOptions` gains two new optional fields (wired in 9.3):

- `webUiStaticPath?: string` — absolute path to a built SPA dir. When set, the daemon mounts `@fastify/static` under `/app/` pointing at that dir. When unset, `/app/*` returns 404 and the daemon runs with no UI (CLI-only mode, CI, tests).
- `uiAuthToken?: string` — per-startup token as specified in §2.

Production layout:

```
apps/factoryd/src/main.ts:
  ...
  const uiAuthToken = randomBytes(24).toString('hex');
  process.env['FACTORY5_UI_TOKEN'] = uiAuthToken;
  const webUiStaticPath = resolveWebUiStaticPath();  // apps/factory-web/dist
  handle = await startDaemon({ host, port, workerAuthToken, uiAuthToken, webUiStaticPath });
```

`resolveWebUiStaticPath()` (new helper in `@factory5/brain` or `@factory5/daemon`) walks from the factoryd dist back to `apps/factory-web/dist` in dev, and in packaged builds looks for a sibling `web/` dir. Path resolution details land at 9.2 scaffold; the ADR fixes only that there is one.

Dev layout:

- Operator runs `pnpm dev --filter factory-web` in one terminal (Astro dev on `:4321`, HMR enabled).
- Operator runs `factoryd --foreground` in another (or leaves the background daemon). factoryd serves `/api/v1/*` on `:25295` as usual.
- Browser opens `http://localhost:4321/app/` — Astro's dev server serves the HTML, and any `fetch('/api/v1/...')` is proxied by Vite to `:25295` (same-origin from the browser's POV; no CORS).
- The `?t=<token>` distribution still works in dev — factoryd logs the dev URL `http://localhost:4321/app/?t=<token>` when it detects a dev build (env `NODE_ENV=development`), otherwise the prod URL.

**Rejected alternatives**: Fastify middleware proxying to the Astro dev server (requires HMR WebSocket upgrade handling through Fastify; brittle, seen it go wrong in other stacks); bundling Astro's server rendering (we don't need SSR; static is enough).

### 4. Routing + API versioning: Astro file-based MPA + `/api/v1/*` URL-prefix versioning

**SPA routing: no SPA shell.** Astro's file-based routing:

```
apps/factory-web/src/pages/
  index.astro              → /app/              (overview dashboard)
  directives/
    index.astro            → /app/directives/
    [id].astro             → /app/directives/:id
  questions/
    index.astro            → /app/questions/
    [id].astro             → /app/questions/:id
  spend/index.astro        → /app/spend/
  findings/index.astro     → /app/findings/
```

Root layout wraps every page with `<ViewTransitions />`. Cross-page navigation feels single-app without the state-management overhead of a real SPA.

**API versioning: `/api/v1/*` URL prefix.** All JSON endpoints live under `/api/v1/…`. Rationale:

- Every other dashboard-API pair factory5's operators know uses URL-prefix versioning (Kubernetes, Docker, Vault, Grafana). Header versioning is a library-designer preference that shifts the burden onto every client.
- `v1` is future-proofing not commitment: we are not planning a v2, but freezing the prefix now means the first mutation Phase 9b adds doesn't force a retrofit.
- Each route's response shape is captured by a Zod schema in `@factory5/ipc` (mirroring the existing IPC-route pattern). Schema evolution stays backward-compatible within `v1`; a breaking change mints `v2`.

Route registration slots into the existing `registerRoutes` function (`packages/daemon/src/server.ts:184`) behind a `const API_V1_PREFIX = '/api/v1'` constant. The bearer preHandler applies to everything starting with that prefix (new `preHandler` scoped with `app.register()` or a prefix-match in the existing preHandler hook — implementation detail for 9.3).

## Consequences

**Positive.**

- **One process, one port, one operator mental model.** Operator browses to `http://127.0.0.1:25295/app/` and the dashboard works. No reverse proxy, no certs, no "did I set up the right port" confusion. Same-origin means no CORS fighting.
- **Scoped tokens survive phase growth.** Adding 9b mutations to `/api/v1/*` doesn't change the auth surface — same `FACTORY5_UI_TOKEN`, same bearer gate, just POST/PATCH handlers added behind it. Worker token stays untouched.
- **Dev-loop ergonomics match every other modern TS dashboard.** `pnpm dev --filter factory-web` + HMR + Vite proxy is the path of least surprise. Onboarding a contributor means "read the Astro docs," not "learn our custom bundler."
- **Bundle size gives us headroom.** Astro's zero-JS default means the overview page can render HTML+CSS only, measured in tens of KB; operators browsing from a latency-sensitive dev machine (Windows laptop on hotel wifi) get sub-500 ms first-paint on localhost.
- **URL-prefix versioning is a standing invitation to extend.** A Phase 11 agent-as-dashboard-tool that wants to read `/api/v1/directives` directly gets a stable contract without having to negotiate `Accept:` headers.
- **Additive to factoryd.** Zero changes to existing `/healthz`, `/status`, `/send`, `/directives/notify`, `/reload-config`, `/worker/ask-user`. Rollback = delete the two new options + static plugin registration.

**Negative.**

- **One new workspace app + one new framework.** `apps/factory-web/` adds Astro + Vite + TypeScript template surface. Astro bumps move in step with Vite; we pin a minor and update deliberately. Mitigated by: the build output is plain HTML/CSS/JS — if Astro ever becomes a burden, swap frameworks and keep the served bundle shape unchanged.
- **Token on disk in sessionStorage.** A malicious browser extension with `storage` permission on `127.0.0.1` could read the token and call `/api/v1/*` (read-only in 9a). Mitigated by: token is loopback-bound at the bind layer too, so the extension's attacker would need local machine access already; rotation-per-startup bounds leak window; sessionStorage (not localStorage) clears on tab close.
- **Query-param token is briefly in history.** Between the URL arriving and the SPA's `history.replaceState`, the `?t=<token>` lives in the browser's address bar for a frame. Mitigated by: `history.replaceState` runs synchronously in the HTML `<head>`'s first `<script>`, before the page paints; practical window is microseconds; same pattern Jupyter and Grafana have shipped for years without incident.
- **Dev and prod URLs differ slightly.** `localhost:4321` vs `127.0.0.1:25295`. Minor cognitive tax; standard for every Vite-app-plus-backend setup operators have seen elsewhere.
- **Astro's `<ViewTransitions />` depends on the browser's View Transitions API.** As of 2026 that's universal in Chromium + WebKit, and Firefox ships it behind a flag. Mitigated by: the API gracefully degrades to a full reload; Firefox operators see the old-school navigation until their browser catches up.
- **`factory ui-token` is a new CLI verb.** Small API surface addition. Mitigated by: it mirrors `factory daemon status` ergonomically; operators who don't want the UI never run it.

**Reversible?** Yes, layered. Remove `webUiStaticPath` from `DaemonOptions` → `/app/*` 404s, no static plugin, dashboard disabled. Remove `uiAuthToken` → `/api/v1/*` returns 503 `UI_DISABLED`. Delete `apps/factory-web/` → the workspace has one fewer app; pnpm-workspace's `apps/*` glob tolerates the gap without config changes. None of the changes touch `packages/`, so the CLI, brain, channels, etc., remain unchanged.

## Alternatives considered

- **Vite+React instead of Astro.** Rejected: heavier bundle for a dashboard this size; forces us to pick a router + state library; adds React 19 + React Router + (likely) TanStack Query to the dependency graph. The familiarity argument is weaker here than elsewhere because the UI surface is small and evolves slowly.
- **lit-html or vanilla.** Rejected: no HMR out of the box; hand-rolled routing; five pages in we'd be re-inventing Astro's feature set poorly. The "smallest bundle" wins are moot on localhost.
- **SvelteKit / Remix / Next.** Rejected unilaterally: all three are SSR-first frameworks, and we explicitly do not want a Node rendering process inside factoryd. Astro is the only widely-adopted choice where "static output + Islands" is the primary mode.
- **Reuse `FACTORY5_WORKER_AUTH_TOKEN` for the UI.** Rejected: conflates scopes (worker-impersonation vs dashboard-read); a leaked dashboard token would let an attacker call `/worker/ask-user` on the brain's behalf. Separation is free (one extra `randomBytes` call).
- **No auth at all ("loopback is enough").** Rejected: any page the operator visits in the same browser can make loopback requests. Findings may contain source-code snippets, repro data, secrets leaked by the agent. Free-to-all-browser-tabs read access to that surface is an own-goal. The worker bearer pattern proved the cost (one token, one constant-time compare) is negligible.
- **Session cookies + login form.** Rejected: requires a login page, password storage, CSRF tokens, and an identity story factory5 doesn't have (there's one operator per instance). Jupyter-style query-param + sessionStorage is proportionate.
- **OIDC / OAuth flow against some external identity provider.** Rejected emphatically: factoryd runs on the operator's workstation with no public ingress; bolting on an identity provider adds a dependency, a network requirement, and a deployment story none of which we need.
- **Server-Sent Events (SSE) for live updates.** Deferred. The overview page's "pending questions count" updating in real time is desirable but not load-bearing — 5-second polling works fine on localhost with factoryd's `better-sqlite3` reads. Phase 9b or a later addendum can layer SSE on top of the same auth gate; today we get the entire dashboard running without it.
- **WebSockets / long-polling.** Rejected for the same reason as SSE but with additional surface area (ping/pong, binary frames, reconnect semantics). If live updates become load-bearing, SSE is the lighter win.
- **GraphQL instead of REST.** Rejected: operators are not shaping queries; the handful of views are known ahead of time. REST + typed Zod schemas is less infrastructure for a known shape.
- **Build a single bundled `factoryd` binary that embeds the static files via `postject` / rolldown.** Deferred as an ops concern, not an architectural one. When/if factory5 packages a single-binary distribution, the `resolveWebUiStaticPath()` helper is the only seam that needs to know "where did my static files land?" The ADR's `webUiStaticPath?` option accommodates both the loose-directory and embedded-bundle shapes.
- **Put the UI on a separate port (e.g. `:25296`).** Rejected: breaks the "one port" constraint, adds a CORS surface where there doesn't need to be one, and forces operators to remember two URLs. The single-port design also lets the bearer gate live in one place.

## Implementation notes

Sub-step mapping (expands `.control/phases/phase-9-web-ui/steps.md`):

- **9.2 — `apps/factory-web/` scaffold.** Astro app with minimal `src/pages/index.astro` ("hello factory"), `astro.config.mjs` pinning the dev port (`4321`) and the Vite proxy (`server.proxy['/api/v1'] = 'http://127.0.0.1:25295'`), `tsconfig.json` extending `tsconfig.base.json`, a one-line `README.md`, scripts `dev` / `build` / `preview` in `package.json`. Astro + `@astrojs/check` + (optionally) `@astrojs/tailwind` added to devDependencies. pnpm-workspace's `apps/*` glob auto-picks it up.

- **9.3 — Fastify static serve + bearer gate.** `DaemonOptions.webUiStaticPath?` + `DaemonOptions.uiAuthToken?`. Mount `@fastify/static` under `/app/` when `webUiStaticPath` is set. Register `/api/v1/*` handlers behind a shared preHandler that calls `checkBearer(request, opts.uiAuthToken)` (generalise the existing `checkWorkerBearer`). `/api/v1/status` returns `{version, uptimeMs, startedAt}` for smoke. `factoryd` main mints `FACTORY5_UI_TOKEN` and prints `ui: http://127.0.0.1:25295/app/?t=<token>`. Test: bearer-missing → 401; bearer-valid → 200; static files served; non-loopback → 403 (existing preHandler still fires).

- **9.4 — `/api/v1/directives` list + detail.** Paged list (default 20; `?limit=&offset=`); detail includes timeline (joined `tasks_inflight` + `pending_questions` + `model_usage` for the directive). Reuses existing `@factory5/state` query helpers; no new SQL logic in the daemon.

- **9.5 — `/api/v1/pending-questions` list + detail.** The Phase 8 forcing function. Supports `?status=open|answered|all` filter. Detail at `/api/v1/pending-questions/:id` for deep-linking from outbound channel messages.

- **9.6 — `/api/v1/spend`.** Surfaces the `factory spend` aggregations (per-project / per-directive / per-day / per-model). Reuses `@factory5/state` `spend` query helpers verbatim.

- **9.7 — `/api/v1/findings`.** List + filter by severity / status / project; `GET` only in 9a.

- **9.8 — SPA pages.** `index.astro` (overview), `directives/`, `questions/`, `spend/`, `findings/`. Layout wraps with `<ViewTransitions />`. Per-page `<script>` fetches from `/api/v1/...` with the bearer; renders into the page's server-rendered skeleton. No client-side routing beyond Astro's built-in page-to-page transitions.

- **9.9 — Live validation.** Operator runs `factoryd --foreground`, opens the logged URL in Chrome/Firefox, navigates through all pages against the existing factory.db (~5 MB, ~100 directives, ~300 questions). Measures fetch latency — each `/api/v1/*` call should be < 100 ms p50 at that scale. Documents first-paint wall-clock to `docs/Phase9_Progress.md`.

- **9.10 — Phase close.** Tag `phase-9-web-ui-closed`; `docs/Phase9_Progress.md`; `CompleteArchitecture.md` gains a §Web UI section with a pointer to this ADR; scaffold Phase 10 (Assessor tier-3).

**Deferred to a future ADR (not Phase 9):**

- Real-time updates (SSE / WebSocket).
- UI-driven mutations (answer question, start build, abort directive) — 9b charter; likely a single new ADR once the surface area is known.
- Cross-host access (operator on laptop, factoryd on home server). Needs a reverse-proxy / tunneling design and almost certainly a proper auth story; out of scope for the Phase 9 "localhost dashboard" goal.
- Multi-instance selector ("I have three factory instances; pick one"). Today each instance has its own port per ADR 0023; the UI stays per-instance. A future meta-UI could list them.
