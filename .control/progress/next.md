# Next session — paste this to start

Phase 9 (Web UI) is 8/10 done as of 2026-04-23T21:00Z.

Eight sub-steps closed this session (9.1 ADR 025 → 9.8 SPA pages).
Every read-side `/api/v1/*` route and every SPA page lands with
unit tests + bearer-gated access + typed schemas. The only
remaining work is **9.9 live browser validation** (operator-in-loop)
and **9.10 phase close + Phase 10 scaffold**.

605 tests across 14 packages, all green. Working tree clean. Tag
`phase-8-worker-ask-user-closed` still the most recent phase tag;
`phase-9-web-ui-closed` waits on 9.10.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md` (latest snapshot
of everything below + the per-step test counts), then
`.control/phases/phase-9-web-ui/{README.md,steps.md}` (only 9.9
and 9.10 remain unchecked).

For context on what the read-side looks like, skim
`docs/decisions/0025-web-ui-architecture.md` — it pins framework
(Astro MPA + `<ClientRouter />`), auth (`FACTORY5_UI_TOKEN` via
`?t=` query → sessionStorage, scoped distinct from the worker
token), bundle serving (`@fastify/static` in prod + Vite proxy in
dev), and routing (`/api/v1/*` URL-prefix versioning; detail pages
use `?id=<ulid>` to stay fully static).

Run `/session-start` for the full drift check.

## Next concrete work — sub-step 9.9 (live validation)

This sub-step needs an operator at a browser. No LLM spend. Expected
duration: ~30 min.

1. Check no stale factoryd is running (`factory daemon status` —
   stop it if so).
2. Start factoryd foreground: `pnpm factoryd --foreground`.
3. In the stdout, find the line:
   `ui: http://127.0.0.1:25295/app/?t=<48-hex-token>`.
   (If the SPA bundle is missing, run
   `pnpm --filter factory-web build` first.)
4. Open the URL in Chrome or Firefox.
5. Verify each page renders against the operator's existing
   factory.db (~5MB, ~100 directives, ~300 questions, ~$63 / 116
   calls of spend history):
   - `/app/` (overview): five summary cards populated — directives
     total, open questions, today spend, all-time spend, open
     findings.
   - `/app/directives/`: list with status filter + limit; clicking
     an id opens `/app/directives/detail?id=<ulid>` with timeline
     (tasks + open questions + spend rollup).
   - `/app/questions/`: defaults to `status=open`; switching to
     `answered` or `all` re-fetches; detail deep-link works.
   - `/app/spend/`: four rollup tables (project / directive / day /
     model); since/until/projectId filters restrict.
   - `/app/findings/`: severity/status/project/advisory filters
     narrow; project supports `*`-glob.
6. Measure latency via DevTools Network panel — each `/api/v1/*`
   call should be sub-100ms p50 on the local factory.db.
7. Capture observations (page load times, any rendering surprises,
   missing data) into `docs/Phase9_Progress.md` as part of 9.10.

If anything fails to render, likely candidates:

- **401 on every page** — `FACTORY5_UI_TOKEN` not captured. Check
  `sessionStorage['factory5.ui-token']` in DevTools Application tab;
  if missing, reopen the factoryd-logged URL (the `?t=` param is
  what seeds it).
- **404 on `/app/*`** — `webUiStaticPath` unresolved. Check
  `apps/factory-web/dist/index.html` exists; rebuild if not.
- **Empty rollups with non-empty db** — check `projectId` filter
  URL-encoding; likely the bar is accepting stray whitespace.

## Then 9.10 — phase close

- Tag `phase-9-web-ui-closed` on the close commit.
- `docs/Phase9_Progress.md` authored with the per-sub-step log
  (mirror `docs/Phase8_Progress.md` shape), incl. the 9.9
  observations.
- `docs/PROGRESS.md` entry appended.
- `CompleteArchitecture.md` gains a §Web UI section pointing at
  ADR 0025.
- Scaffold `.control/phases/phase-10-assessor-tier3/{README.md,steps.md}`
  per the "Forward queue" section in `phase-9-web-ui/README.md`.

## Carry-forward from Phase 8

- **Issue I009** (MEDIUM, OPEN) — Telegram/Discord `/build` inbound
  doesn't inherit `[budget.defaults]`. Non-blocking.
- **Issue I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO
  matcher can't target a specific open question. Non-blocking; 9b
  mutation surface could close this functionally with a "choose
  question" picker.
- **Resource-hygiene note** — `askUser` handler's poll loop keeps
  running after the worker subprocess exits. Cosmetic.
- **Phase 6 operator follow-up (still unchanged, still non-blocking):**
  PAT revoke at <https://github.com/settings/tokens>;
  `gh repo delete momobits/factory5-6b-smoke --yes`;
  `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

## Nice-to-have follow-ups surfaced this session

Not blocking 9.9 or 9.10; could land at any point in Phase 9.10's
tidy-up or Phase 10+:

- **`factory ui-token` CLI command.** ADR 0025 §2 described it,
  9.3 scope was daemon-wiring only. Small IPC route on factoryd
  - `packages/cli/src/commands/ui-token.ts`. Operator who closes
    the terminal loses the URL today; mitigation is to restart
    factoryd and copy the new URL.
- **Refactor inline bearer checks to a Fastify preHandler scoped
  to `/api/v1/*`.** Effect is identical to current handler-level
  checks; purely stylistic.
- **SSE for live updates.** Explicitly deferred by ADR 0025
  §Alternatives. Polling works on localhost; layer on top of the
  existing bearer once UX pressure materialises.

Report back on wake-up with a status block in this shape:

```
Phase 9 — 8/10 closed; 9.9 live validation next
Last action: 9.8 SPA pages committed (5190f44); docs(state) on top
Git: branch=main, last=<sha> <subject>, uncommitted=no, tag=phase-8-worker-ask-user-closed
Open blockers: 0 (I009 + I012 are non-blocking carry-forward)
Proposed next action: 9.9 live browser validation — follow 7-step checklist in STATE.md
Ready to proceed?
```
