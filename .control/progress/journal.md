# Journal

Append-only, newest on top. One entry per session, short. Minor fixes land here as one-line entries (see Issue flow in `.control/PROJECT_PROTOCOL.md`).

## 2026-05-03 — Steps 3.2 + 3.3 shipped (SSE FE wiring + Astro component library)

- Step range 3.2-3.3 across `db61baf..94b8b71` (3 commits including a session-start drift reconcile).
- Session-start drift reconcile (`db61baf`) — same post-session-end pointer drift as `cce7065` last session: STATE.md "Last commit" pointed at `772f9f3` (the 3.1 feat) but actual HEAD was the `15bbad3` session-end docs commit. Caught by the SessionStart hook's `[control:drift] commit-mismatch` block; reconciled by updating STATE.md's Git state pointer + adding a new "Recently completed" entry for `15bbad3`. The reconcile commit itself reproduces the same one-behind shape — structural to the no-amend protocol.
- Step 3.2 (`998e7d8`) — `feat(3.2): wire directive detail page to SSE stream`. New `apiStream<T>(path, callbacks)` helper in `apps/factory-web/src/lib/api.ts`: token-auths via `?t=<UI_TOKEN>` query param (EventSource cannot set custom headers), Zod-validates each payload via `directiveStreamEventSchema`, surfaces a six-state connection machine (connecting → live → reconnecting → polling | disconnected → completed), degrades to a 5 s polling fallback when EventSource gives up retrying. `directives/detail.astro` rewritten: incremental `Map<taskId, Task>` render, atomic spend swap, log tail panel rendered only after the first `log.line` arrives, connection-state pip in the header (subtle pulse on green when live, blink amber when reconnecting, dashed grey when completed). Polling-fallback merge rule prefers existing live-event Map entries over snapshot rows so a brief polling window can't clobber a finer-grained `task.completed` status with a stale `running` row.
- New `./sse` sub-export on `@factory5/ipc` keeps `undici` / `@factory5/logger` out of the FE bundle: package.json gains the sub-export entry; tsup build script gains `src/sse.ts` as a second entry; emits `dist/sse.js` + `dist/sse.d.ts` alongside existing `index.js`. `apps/factory-web` adds `@factory5/ipc: workspace:*` to dependencies.
- Step 3.3 (`94b8b71`) — `feat(3.3): astro component library — Card / Table / EmptyState / Alert / Form / PageShell`. Eight new server-rendered components under `apps/factory-web/src/components/` (Card, Table, EmptyState, Alert, Form, Field, Submit, PageShell). Each ships with a typed `interface Props`, scoped `<style>` mirroring `Dashboard.astro`'s `color-mix(in srgb, currentColor X%, transparent)` palette + form/btn/alert/card class styles, and TSDoc'd intent. Component README documents conventions + per-component usage examples + the 3.4 migration map.
- 3.3 is **library-only** — no page consumes the components yet. Visual is unchanged because each component duplicates the matching CSS from `Dashboard.astro` under Astro's auto-scoping. The Dashboard-level CSS gets gutted in 3.4 once every page has migrated.
- Tests: 0 new tests this session. Workspace test count holds at 1040 across 73 files (the prior STATE.md's "76" was a slight miscount — actual is 73; the 3.1 session added `sse.test.ts` + `directive-stream-route.test.ts` for +2 files vs. earlier baseline, putting us at 73). The SSE FE wiring relies on the existing 152 daemon SSE-route tests for wire shape; `factory-web` has no vitest harness yet (deferred — adding jsdom + EventSource polyfill is a multi-file change for one test file's worth of value).
- ADRs decided: none. ADR 0029 (directive-stream protocol) still gated on FE consumer being smoke-tested end-to-end against a real factoryd, which lands as part of 3.4's acceptance smoke.
- Issues opened / closed: none.
- Minor fixes: textarea whitespace handling in `Field.astro` — Astro preserves whitespace inside `<textarea>` so a multi-line expression body would leak indent as the field's initial value; switched to `set:html` for the textarea body.
- Blockers hit: 11 ts(18047) "mount is possibly null" errors in `detail.astro` after the rewrite — TypeScript narrowing didn't propagate `if (mount === null) throw` into closure-scoped function bodies. Fixed by introducing a typed non-null local `const mount: HTMLElement = mountEl` after the throw guard. Single-line README format issue auto-fixed by `prettier --write`.
- All four `pnpm` gates green at every commit: build / test (1040 unchanged) / lint / format:check.
- Step 3.1 deferred work (still open): `finding.created` brain emission and `log.line` forwarder. The FE now has the listener wiring in place via 3.2 (Map mutation + log tail append, both no-op until events flow). Either land in a 3.x sub-step or defer to a follow-up tier — neither blocks 3.4.
- Loose ends still open from prior session (not blocking 3.4): synthetic smoke directive `01KQPDMQE6QTQZ3QMDD69019YK` + `demo-project` in DB; factoryd PID 32436 may still be running.
- Next: step 3.4 — convert all 10 pages in `apps/factory-web/src/pages/` to consume the component library; retire `el()` from `lib/api.ts`; gut the duplicated CSS from `Dashboard.astro`.

## 2026-05-03 — Step 3.1 shipped (SSE backend + brain emission)

- Step range 3.1 across `cce7065..772f9f3` (2 commits).
- Session-start drift reconcile (`cce7065`) — STATE.md "Last commit" pointed at the prior post-phase-2 docs commit (`f7c78ce`) but actual HEAD was the `733ce5a` session-end bookkeeping commit. Caught by the SessionStart hook's `[control:drift] commit-mismatch` block; reconciled by updating STATE.md's Git state pointer (the new commit reproduces the same one-behind shape, but it's structural — every STATE.md-only commit lands one behind itself unless you `--amend`, which CLAUDE.md forbids).
- Step 3.1 (`772f9f3`) — `feat(3.1): SSE on /api/v1/directives/:id/stream`. Six-event protocol pinned in `UPGRADE/specs/sse-directive-stream.md`. Six Zod event schemas + discriminated union in new `packages/ipc/src/sse.ts`. `DirectiveStreamHub` in `packages/daemon/src/directive-stream.ts` (subscribe / emit / closeDirective / shutdown; synchronous dispatch so a slow consumer can't backpressure the producer). Fastify SSE handler in `packages/daemon/src/directive-stream-route.ts` via `reply.hijack()` over `reply.raw` — auth via either `Authorization: Bearer …` or `?t=<token>` query param (browsers' EventSource cannot set headers); 404 / 401 / 503 pre-stream errors; backfill on connect synthesizes `task.started` (+ `task.completed` for terminal tasks) plus a baseline `spend.updated`; already-terminal directives short-circuit with one `directive.completed` and stream close; 15 s heartbeats; cleanup on `request.raw.on('close')`. Brain emission via new `BrainOptions.emitDirectiveEvent` callback typed as `DirectiveEventEmitter` from `@factory5/ipc` — daemon's `brain-supervisor` wires it to `hub.emit`; threaded through `runServe` → `defaultRunOne` → inline `runBrain` so both inline and serve paths emit. Pool emits `task.started` / `task.completed` / `spend.updated`; loop emits `directive.completed` at all six terminal-status branches (chat / non-build / architect-abort / planner-abort / normal / budget-exceeded).
- **Deferred from 3.1:** `finding.created` and `log.line` brain emission. Spec carries the event shapes, route forwards them, schemas + tests cover them. `finding.created` is a small follow-up (one event per entry in `outcome.result.findingsRaised` from `pool.ts`); `log.line` is more invasive (selective pino-stream tap) and may defer indefinitely. FE will refresh findings on each `task.completed` until `finding.created` is wired.
- Tests: 14 new schema cases in `packages/ipc/src/sse.test.ts` + 15 new end-to-end SSE route cases in `packages/daemon/src/directive-stream-route.test.ts` driving a real bound socket via Node's streaming `fetch` body (auth, 404, backfill on connect for in-flight + terminal tasks, already-terminal short-circuit + `blockedReason` forwarding, live `hub.emit` round-trip, directive scoping (events for one don't leak to another), heartbeat after idle with a small heartbeat interval, listener cleanup on client disconnect via `hub.listenerCount`).
- Workspace test count went from prior baseline to 1040 across 76 files (+29 new tests this session). Daemon 137 → 152; ipc 14 → 28. All four `pnpm` gates green.
- ADRs decided: none. Spec lives at `UPGRADE/specs/sse-directive-stream.md`; promotion to **ADR 0029 — directive-stream protocol** held until 3.2 ships and the FE consumer validates the contract end-to-end.
- Issues opened / closed: none. Step 3.1 was infrastructure-only.
- Minor fixes: added `.serena/` to `.gitignore` (Serena MCP server's `activate_project` drops a per-operator project descriptor there; not shared, not part of the build).
- Blockers hit: none. Two ESLint `prefer-const` errors during the lint gate from a `let unsubscribe` / `let heartbeatTimer` pattern in the SSE route handler — refactored to a `const subscription = { unsubscribe?: () => void }` holder so the late-bound subscription handle could be assigned without a `let` binding, and made `heartbeatTimer` `const` from the start.
- Step 2.6 (`factory chat` per-turn timeout) carryforward: infrastructure ready via this SSE stream; full resolution lands in 3.5 when `/app/chat` routes chat directives through it. Until then the 120 s false-timeout could still bite a chat directive that takes longer than 120 s for the first turn — same state as before this session.
- Loose ends still open from prior session (not blocking 3.2): synthetic smoke directive `01KQPDMQE6QTQZ3QMDD69019YK` + `demo-project` in DB; factoryd PID 32436 still running.
- Next: step 3.2 — wire `directives/detail.astro` to the SSE stream + add `apiStream<T>(path)` helper to `lib/api.ts`.

## 2026-05-03 — Session-end after phase-2 close + post-close docs polish

- Single small commit landed after `/phase-close`: `f7c78ce` `docs(2): document factory/factoryd PATH setup in ONBOARDING`. Closes a doc gap surfaced when operator asked "where do I run `factory daemon stop`?" — the existing onboarding doc said "once factory5 is on your `$PATH`" without ever explaining how to put it there.
- Working tree clean at session-end. HEAD = `f7c78ce`. Phase-2 tag on `081b832`.
- Synthetic smoke data still resident in DB; `packages/state/smoke-cleanup.mjs` available. Daemon (PID 32436) still running.
- No blockers. Next session opens at Phase 3.1 (SSE on `/api/v1/directives/:id/stream`).

## 2026-05-03 — Phase 2 closed (tag `phase-2-channel-parity-closed` on `081b832`); Phase 3 kicked off

- Steps 2.3, 2.4, 2.5 all shipped through prior-session work; Step 2.6 deferred to Phase 3 (folded into SSE streaming).
- This session: completed live-smoke checklist for `/phase-close` — Discord+Telegram slash command surfaces verified, free-form chat re-routing verified on both, `factory cancel` IPC route paths verified (NOT_FOUND/ALREADY_TERMINAL/OK), CLI exit codes 0/2/3 verified.
- Out-of-step UX fix: `fix(2.2): show project name in /status output` (`081b832`) — operator complaint that the recent-directives table showed only directive IDs, not which project they belonged to. Added a project column to Discord embed, Telegram HTML reply, and CLI table; new shared `makeProjectNameLookup` helper.
- Tag annotated with full phase-2 shipping summary.
- Phase 3 scaffold landed: `.control/phases/phase-3-web-ui/{README.md, steps.md}` with carry-forward of Step 2.6 in "Why this phase exists".
- Synthetic smoke directive remains in DB (id `01KQPDMQE6QTQZ3QMDD69019YK`, status=failed/cancelled). `packages/state/smoke-cleanup.mjs` available if user wants to reap; permission-gated via Bash settings.
- Gates: build / test (175 channels, 82 cli, full workspace ≥ 938) / lint / format:check all green.
- Next: Step 3.1 — SSE on `/api/v1/directives/:id/stream`.

## 2026-05-02 — Phase 2 session 2a — slash + setMyCommands

- Step range 2.1-2.2 across `8ea8e4a..22e0e54` (2 commits + this session-end).
- Step 2.1 (`8ea8e4a`) — Discord slash commands. New `discord-commands.ts` (single `/factory` command with seven subcommands: status / spend / findings / resume / cancel / budget / build). New `setProjectBudget` callback on `ChannelContext` + `SetProjectBudgetError` sentinel; daemon binds it over `wiki.updateProjectMetadata`. 23 unit tests added covering every subcommand, allow-list gate, and major error paths. Closes structural piece of U011 (live-smoke still required at phase-close).
- Step 2.2 (`22e0e54`) — Extracted transport-agnostic `command-handlers.ts` (each handler returns either typed data or `CommandResult<T>` for user-visible failures with a stable `code`). Refactored `discord-commands.ts` to delegate. Telegram side: added `setMyCommands` to `TelegramApi` (optional in contract; default HTTP factory provides), `parseMode` on `sendMessage`, slash dispatcher replacing the old `/build`-only parser, HTML-mode formatter with `<pre>` blocks for tabular reads. 10 new Telegram tests. Closes structural piece of U012 (live-smoke pending). Side effect: `payload.text` is no longer set on build directives — confirmed unused, dropped one roundtrip-test assertion.
- ADRs decided: none (judgement calls within tier-2 plan, not architectural).
- Issues opened / closed: U011 + U012 partially addressed (structural pieces shipped; live-smoke acceptance held until `/phase-close`).
- Minor fixes: `.claude/hooks/regenerate-next-md.ps1` UTF-8 round-trip fix — read with `-Encoding utf8`, write without BOM via `UTF8Encoding $false` for parity with the bash sibling. Logged as a known bug at end of step 2.0; fixed during the 2.2-2.3 idle window per the "Phase 2 idle" note in last STATE.md.
- Blockers hit: none.
- Gates: build / test (938 total, 103/103 channels) / lint / format:check all green.
- Next: step 2.3 — pending-question button affordances.

## 2026-05-02 — Phase 1 closed; Phase 2 kicked off
- Phase 1 (doc-sweep) closed: tag `phase-1-doc-sweep-closed` on `10e400a`; close commit `1384ae8`.
- Step range 1.1-1.8 across `91541a9..10e400a` (9 commits, doc-only).
- Issues closed: U001, U002, U003, U014, U015, U016, U017 (7 of 23 catalogued; all Tier-1).
- ADRs decided: none (doc-only phase, as anticipated).
- Minor fixes: orphan `factory inspect` reference removed from `packages/logger/README.md` while sweeping for broken refs.
- Blockers hit: none. Hook drift at session start (commit-mismatch + tag-mismatch) reconciled via `91541a9` before any step work began.
- All four `pnpm` gates green throughout (build, test 876p/3s, lint, format:check).
- Next: step 2.1 — wire Discord slash commands.

## 2026-05-02 — Session bootstrap
- Control framework v2.2.1 installed (commit `e94393e`); `/bootstrap` populated SPEC + phase plan + Phase 1 scaffold.
- Next: Phase 1 doc-sweep.
