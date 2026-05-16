# factory-web

Browser dashboard for factory5. Astro MPA + Islands + `<ViewTransitions />`,
served by `factoryd` under `/app/*` (ADR 0025).

## Dev loop

```bash
# Terminal 1: factoryd (serves /api/v1/*)
pnpm factoryd

# Terminal 2: Astro dev server (serves /app/* with HMR; proxies /api/v1 → 25295)
pnpm --filter factory-web dev
# → http://localhost:4321/app/?t=<FACTORY5_UI_TOKEN>
```

The Vite proxy in `astro.config.mjs` forwards `/api/v1/*` to
`http://127.0.0.1:25295`, so browser fetches are same-origin from the
dev server's POV — no CORS config needed on factoryd.

## Production

```bash
pnpm --filter factory-web build
# → apps/factory-web/dist/  (static HTML/CSS/JS)

pnpm factoryd
# factoryd mounts @fastify/static under /app/ pointing at apps/factory-web/dist/
# → http://127.0.0.1:25295/app/?t=<FACTORY5_UI_TOKEN>
```

## Auth

`FACTORY5_UI_TOKEN` is minted per `factoryd` startup (ADR 0025 §2). The
SPA catches `?t=<token>` from the initial URL, stores it in
`sessionStorage['factory5.ui-token']`, and sends `Authorization: Bearer
<token>` on every `/api/v1/*` fetch. Recover a lost token with
`factory ui-token` — it queries the running daemon over the loopback
`/ui-token` IPC route and prints the dashboard URL with the live bearer.

## TypeScript config divergence

`tsconfig.json` here extends `astro/tsconfigs/strict` rather than the
repo-root `tsconfig.base.json`. Browser-target TS needs `moduleResolution:
bundler`, `lib: [ES2022, DOM, DOM.Iterable]`, and Astro's own types —
incompatible with the Node-target base config used by `packages/` and the
other apps. Strictness settings still match (`strict`, `noUncheckedIndexedAccess`,
etc. — Astro's preset ships them on).

## Pages

File-based routing under `src/pages/` (ADR 0025 §4). The ten SPA pages today:

| URL path                          | File                      | Purpose                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/app/`                           | `index.astro`             | Overview — recent directives, open question count, spend headline                                                                                                                                                                                                                                                                                                              |
| `/app/build/`                     | `build.astro`             | New build form — picks project, sets autonomy / budget, POSTs `/api/v1/builds`                                                                                                                                                                                                                                                                                                 |
| `/app/directives/`                | `directives/index.astro`  | Paged directive list with status filter                                                                                                                                                                                                                                                                                                                                        |
| `/app/directives/detail/?id=<id>` | `directives/detail.astro` | Directive detail — inflight tasks, open pending questions, spend, plus an SSE-live **Activity** panel narrating brain stages (triage → architect → planner → pool → terminal) and a vermillion **Resume** pill on terminal directives (`failed`/`blocked`/`complete`, intent=build) that POSTs `/api/v1/directives/:id/resume`. ADR 0031 covers the brain-side emit convention |
| `/app/projects/`                  | `projects/index.astro`    | Project registry list (most-recently-touched first). "Last build" column links to the latest build directive's detail; per-row Resume pill on terminal-non-running rows                                                                                                                                                                                                        |
| `/app/projects/detail/?id=<id>`   | `projects/detail.astro`   | Project detail with budget-defaults editor (PUT `/api/v1/projects/:id/budget`, ADR 0027)                                                                                                                                                                                                                                                                                       |
| `/app/questions/`                 | `questions/index.astro`   | Pending-question list — `open` / `answered` / `all` scopes                                                                                                                                                                                                                                                                                                                     |
| `/app/questions/detail/?id=<id>`  | `questions/detail.astro`  | Question detail with answer form (POST `/api/v1/pending-questions/:id/answer`, ADR 0027 §2)                                                                                                                                                                                                                                                                                    |
| `/app/spend/`                     | `spend/index.astro`       | Spend dashboard — per-project / -directive / -day / -model rollups                                                                                                                                                                                                                                                                                                             |
| `/app/findings/`                  | `findings/index.astro`    | Cross-project findings list with severity / status filters                                                                                                                                                                                                                                                                                                                     |

The detail pages read their id from a query string (`?id=<…>`) rather than using Astro's `[id].astro` dynamic-route convention. That keeps the prod build a static set of HTML files that `@fastify/static` can serve without route-rewrite logic. List and detail pages share the `src/lib/api.ts` envelope wrapper for every `/api/v1/*` call (token attach, error unwrap, redirect-to-token-form on 401).
