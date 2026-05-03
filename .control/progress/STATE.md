# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-03 09:45 UTC by /session-start (reconcile last-commit pointer to actual HEAD)
**Current phase:** 3 — web-ui
**Current step:** 3.1 — SSE on `/api/v1/directives/:id/stream` (next; phase 2 closed)
**Status:** ready (clean working tree; phase 2 tag landed; ONBOARDING PATH-setup gap closed)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Open [`../phases/phase-3-web-ui/README.md`](../phases/phase-3-web-ui/README.md) and [`steps.md`](../phases/phase-3-web-ui/steps.md). Step **3.1 = SSE on `/api/v1/directives/:id/stream`** per [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md) §3.1. Adds an SSE route on the daemon emitting `task.*`, `finding.created`, `spend.updated`, `log.line`, and `directive.completed` events; replaces the polling pattern in `apps/factory-web/src/pages/directives/detail.astro`. The carried-forward Step 2.6 (`factory chat` per-turn timeout) is naturally subsumed by this work — once partial daemon-side progress streams, the 120 s false-timeout problem disappears without a constant bump.

---

## Git state

- **Branch:** main
- **Last commit:** `733ce5a` — docs(state): session end for step 3.1
- **Uncommitted changes:** none (working tree clean)
- **Last phase tag:** `phase-2-channel-parity-closed` (annotated tag at commit `081b832`)

---

## Open blockers

- None

---

## In-flight work

None. Phase 2 closed cleanly; 3.1 has not started.

---

## Test / eval status

- **Last test run:** 2026-05-03 — full workspace passes (channels: 175/175 across 6 files; cli: 82/82 across 8 files; total ≥ 938 from prior baseline plus the new cancel + chat-routing + button + project-column tests added this phase). All four `pnpm` gates green: build / test / lint / format:check.
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness

---

## Recent decisions (last 3 ADRs)

- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)
- ADR 0026 — pluggable-runtime-contract (assessor pluggable across Python / Node / Go / Rust; env-owning vs env-assuming provisioner; failure-mode taxonomy)

No new ADRs decided in this phase — `command-handlers.ts` extraction (2.2), `OutboundMessage.metadata.questionId` contract (2.3), per-directive `AbortController` registry shape (2.4), and the channel-side keyword sub-router for spend/findings within `intent=status` (2.5) were all judgement calls within the tier-2 plan, not architectural decisions worth a new ADR.

---

## Recently completed (last 5 steps)

- Post-phase-2 docs polish — `docs(2)`: documented `factory`/`factoryd` PATH setup in `docs/ONBOARDING.md` §3.5 (three options: pnpm dev scripts / `pnpm link --global` / shell-wrapper functions); §3.4's "once factory5 is on your `$PATH`" now points at §3.5 — 2026-05-03 — `f7c78ce`
- Phase 2 closed (`chore(phase-2): close phase 2, kick off phase 3`); tag `phase-2-channel-parity-closed` on `081b832`; Phase 3 scaffolded — 2026-05-03 — `384d2d3`
- Post-2.2 UX fix — `fix(2.2)`: project name column in `/status` output across CLI, Discord, Telegram (shared `makeProjectNameLookup` helper); surfaced during live-smoke when the directives table only showed IDs — 2026-05-03 — `081b832`
- Step 2.6 — `docs(2.6)`: deferred `factory chat` per-turn timeout to Phase 3; the SSE streaming work in 3.1 naturally subsumes the fix — 2026-05-02 (~) — `3cea98c`
- Step 2.5 — `feat(2.5)`: triage classifies chat across 8 intents; channel handlers re-route reads — 2026-05-03 — `72c45e3`

---

## Attempts that didn't work (current step only)

- None yet — Step 3.1 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host

---

## Notes for next session

Phase 3 brings the web UI from vanilla DOM-in-Astro to real Astro components with live updates via SSE, plus a chat surface and mobile-responsive nav. The phase splits naturally into 3a (SSE + component-library + page conversion) and 3b (chat / projects-new / cancel-pause buttons / spend charts / mobile nav / explicit logout). Issues addressed: U006, U007, U008, U009, U010, U022.

**Carried forward from Phase 2:** Step 2.6 (`factory chat` per-turn timeout) — the cheap path was a bump to 600 s; the better path is partial daemon-side progress streaming. Phase 3.1's SSE route is the natural home for the streaming work — once it ships, the 120 s false-timeout problem disappears for chat as well.

**Step 3.1 design notes:**

- The SSE route is `/api/v1/directives/:id/stream`. Events: `task.*` (created / updated / completed), `finding.created`, `spend.updated`, `log.line`, `directive.completed`. Use Fastify's reply.raw for the SSE pump.
- Author the wire shape in `packages/ipc/src/sse.ts` (or similar) so the brain emits via a single helper. Channel for events: the existing `Doorbell` infra plus a per-directive subscription map.
- Replace the polling loop in `apps/factory-web/src/pages/directives/detail.astro` with an EventSource subscription. Keep the polling fallback for browsers behind a proxy that strips SSE.
- Spend page (`/app/spend/index.astro`) should also subscribe — every `spend.updated` event refreshes the rollup. Tests: a vitest-backed harness driving the SSE route end-to-end.

**Pre-2026-05-03 baseline live-smoke (carried into Phase 3):** Discord+Telegram slash command surfaces are live-verified. Free-form chat re-routing (Telegram private chat; Discord with @-mention) verified. `factory cancel` IPC route paths verified (NOT_FOUND / ALREADY_TERMINAL / OK + CLI exit codes 0/2/3); subprocess-kill chain not live-smoked this phase but unit-test coverage is dense (30 tests across pool / registry / state / daemon / CLI).

**Loose ends from this session (operator may want to clean before Phase 3):**

- Synthetic smoke directive in DB (`01KQPDMQE6QTQZ3QMDD69019YK`, status=failed/cancelled) plus a synthetic project (`demo-project`) and its linked directive — both inserted by the live-smoke probes. `packages/state/smoke-cleanup.mjs` reaps them. The Bash sandbox denies direct `node` invocation against the DB without operator approval; run manually with `cd packages/state && node smoke-cleanup.mjs` if you want a clean `factory status`.
- factoryd PID 32436 still running (started at 09:20 UTC for live-smoke). `factory daemon stop` (or any of the §3.5 invocation forms) shuts it down.
- The `.factory1/` line that briefly appeared in `.gitignore` got cleaned at some point during this session (working tree is clean as of session-end). If it re-surfaces, source-trace via `git blame` on a future commit.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
