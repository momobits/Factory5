# Phase 9 Steps — Web UI

> **Sub-step 9.1 opens next.** The rest are outlines that expand once
> 9.1's ADR pins the framework + bundling + auth choices. Per the
> Phase 7 / Phase 8 pattern, sub-step bodies grow as each session opens.

## Phase 9 — Web UI

- [x] 9.1 — **ADR 025** web-UI architecture. Decisions to pin:
  - **Framework**: Astro (static-first; matches the read-only surface 9a ships) vs Vite+React (more familiar; heavier dev-loop) vs lit-html or vanilla (smallest bundle). Consider bundle size vs operator's own dev-environment expectations.
  - **Auth**: reuse `FACTORY5_WORKER_AUTH_TOKEN` (minted at factoryd startup per 8.2) vs mint a separate `FACTORY5_UI_TOKEN` with different scope vs no-auth-on-loopback (the CLI doesn't authenticate; bearer gate already localhost-bound). Recommendation lean: separate token rotated per startup, printed to the operator on first load (paste-into-browser UX).
  - **Bundle serving**: Fastify static plugin (`@fastify/static`) vs Astro dev middleware vs build-time prebundled. Prod ships prebundled; dev loop likely needs middleware.
  - **Routing + state**: client-side routing (Astro's `<ViewTransitions>` or a lightweight SPA shell) vs full MPA. MPA is simpler but loses "feel" once the operator is navigating in an active session.
  - Output: `docs/decisions/0025-*.md` + INDEX row.

- [x] 9.2 — `apps/factory-web/` scaffold. New workspace app (not package) with its own `package.json`, `tsconfig.json`, dev script. Wire into pnpm-workspace via `apps/*` glob (no edit needed). Minimal "hello world" page served by the chosen framework's dev server. Include the bearer-token gate scaffolding even in dev.

- [x] 9.3 — Fastify static serve + bearer gate wiring. New daemon option + route namespace:
  - `DaemonOptions.webUiStaticPath?` (absolute path to the built SPA dir)
  - `DaemonOptions.uiAuthToken?` (bearer)
  - Fastify `/app/*` serves static, `/api/v1/*` is bearer-gated
  - `/api/v1/status` returns the same shape as IPC `/status` for smoke

- [x] 9.4 — `/api/v1/directives` list + `/api/v1/directives/:id` detail. Paged list; detail includes timeline (tasks_inflight + pending_questions for the directive + model_usage rollup).

- [x] 9.5 — `/api/v1/pending-questions`. The Phase 8 forcing function for Phase 9 UX — surface open questions prominently so operators can see at a glance "what is factory waiting for me on?" Exposes `/api/v1/pending-questions/:id` too for deep-linking from outbound channel messages.

- [x] 9.6 — `/api/v1/spend`. Surface the existing `factory spend` aggregations (per-project / per-directive / per-day / per-model). Reuse `@factory5/state` `spend` query helpers; no new query logic in the daemon.

- [ ] 9.7 — `/api/v1/findings`. List + filter by severity / status / project. Uses existing findings-registry helpers.

- [ ] 9.8 — SPA pages:
  - `overview.html` — at-a-glance dashboard (directive counts by status, pending question count, today's spend, open findings)
  - `directives/` — list + detail
  - `questions/` — pending-question list
  - `spend/` — spend rollups with per-project / per-day filters
  - `findings/` — findings list with severity / status / project filters

- [ ] 9.9 — Live validation. Start factoryd with `webUi` enabled, open `http://127.0.0.1:25295/app/` in a browser, confirm every page loads + shows real data (use the operator's current directives/findings/spend corpus). Measure latency: each API call < 100 ms at the p50 against the operator's local factory.db (~5 MB).

- [ ] 9.10 — Close Phase 9 (tag `phase-9-web-ui-closed`). `docs/Phase9_Progress.md` + `docs/PROGRESS.md` entry + `CompleteArchitecture.md` §? pointer update (new "Web UI" section). Scaffold Phase 10 (Assessor tier-3).
