# Journal

Append-only, newest on top. One entry per session, short. Minor fixes land here as one-line entries (see Issue flow in `.control/PROJECT_PROTOCOL.md`).

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
