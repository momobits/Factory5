# Next session — paste this to start

Phase 8 closed cleanly 2026-04-23 (tag `phase-8-worker-ask-user-closed`).
Worker-subprocess `ask_user` shipped end-to-end via MCP — ADR 0024
accepted, 8 sub-steps + one mid-phase `fix(8.7)`, 564 tests across 14
packages, live validation against a Telegram-initiated build passed
the primary objective (builder MCP `ask_user` → Telegram round-trip).

Phase 9 (Web UI) is scaffolded and active. 3–5 sessions estimated.
The Phase 8 pending-questions work now makes "surface open questions
in the browser" a compelling headline feature that pays for the
dashboard on its own.

## Pickup

Read `CLAUDE.md`, then `.control/progress/STATE.md`, then
`.control/phases/phase-9-web-ui/README.md` + `steps.md` for the
Phase 9 charter. Skim `docs/Phase8_Progress.md` for the immediate-
prior phase retrospective (especially the carry-forward section —
I009 + I012 are open).

Run `/session-start` for the full drift check.

## Next concrete work — sub-step 9.1 (ADR 025: web-UI architecture)

Pin the four architectural decisions before any code lands:

1. **Framework**: Astro (static-first; matches the read-only surface 9a ships), Vite+React (more familiar but heavier dev-loop), or lit-html / vanilla (smallest bundle). Consider bundle size vs operator's dev-environment expectations.
2. **Auth**: reuse `FACTORY5_WORKER_AUTH_TOKEN` (minted at factoryd startup per 8.2) vs mint a separate `FACTORY5_UI_TOKEN` with different scope vs no-auth-on-loopback. Recommendation lean: separate token rotated per startup, printed to the operator on first load.
3. **Bundle serving**: Fastify static plugin (`@fastify/static`) vs framework dev middleware vs build-time prebundled. Prod ships prebundled; dev loop likely needs middleware.
4. **Routing model**: client-side SPA routing (Astro `<ViewTransitions>` or lightweight SPA shell) vs full MPA. MPA simpler but loses feel once the operator navigates during an active directive.

Output: `docs/decisions/0025-web-ui-architecture.md` + INDEX row.

Anticipated downstream sessions:

- **9.2** — `apps/factory-web/` scaffold, dev loop working (`pnpm dev --filter factory-web`).
- **9.3** — Fastify static serve + bearer gate + `/api/v1/status` smoke.
- **9.4–9.7** — Read-side JSON API endpoints (directives, questions, spend, findings).
- **9.8** — SPA pages (overview / directives / questions / spend / findings).
- **9.9** — Live validation (browser against real factoryd).
- **9.10** — Phase close + Phase 10 scaffold (Assessor tier-3).

## Decisions awaiting your input

No blocking decisions. 9.1 is self-contained and I can start authoring
the ADR without further input — but if you have a strong prior on
framework choice (e.g. "I want React because I already have the
vocabulary"), surfacing it at 9.1 open saves a recommend-reject
round-trip.

## Carry-forward from Phase 8

- **Issue I009** (MEDIUM, OPEN) — Telegram/Discord `/build` inbound doesn't inherit `[budget.defaults]`. Non-blocking.
- **Issue I012** (LOW, OPEN) — `maybeAnswerPendingQuestion` FIFO matcher can't target a specific open question. Non-blocking.
- **Resource-hygiene note** — `askUser` handler's poll loop keeps running after the worker subprocess exits. Cosmetic.
- **Phase 6 operator follow-up (still unchanged, still non-blocking):** PAT revoke at <https://github.com/settings/tokens>; `gh repo delete momobits/factory5-6b-smoke --yes`; `reg delete "HKCU\Environment" /v GITHUB_TOKEN /f`.

Report back on wake-up with a status block in this shape:

```
Phase 9 — scaffolded, 0 of 10 sub-steps closed
Last action: phase-8 close committed (<sha>), phase-9 scaffolded
Git: branch=main, last=<sha> <subject>, uncommitted=no, tag=phase-8-worker-ask-user-closed
Open blockers: 0
Proposed next action: sub-step 9.1 — author ADR 025 on web-UI architecture
Ready to proceed?
```
