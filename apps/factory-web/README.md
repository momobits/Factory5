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
`factory ui-token` (wired in 9.3).

## TypeScript config divergence

`tsconfig.json` here extends `astro/tsconfigs/strict` rather than the
repo-root `tsconfig.base.json`. Browser-target TS needs `moduleResolution:
bundler`, `lib: [ES2022, DOM, DOM.Iterable]`, and Astro's own types —
incompatible with the Node-target base config used by `packages/` and the
other apps. Strictness settings still match (`strict`, `noUncheckedIndexedAccess`,
etc. — Astro's preset ships them on).

## Routing

File-based under `src/pages/`. See ADR 0025 §4 for the full tree.
