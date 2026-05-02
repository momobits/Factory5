# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-02 22:35 UTC by /session-end (session 2a complete)
**Current phase:** 2 — channel-parity
**Current step:** 2.3 — Pending-question button affordances (next; 2.1 + 2.2 closed)
**Status:** ready (clean working tree; phase 2a tier — slash + setMyCommands — done)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Open [`../phases/phase-2-channel-parity/README.md`](../phases/phase-2-channel-parity/README.md) and [`steps.md`](../phases/phase-2-channel-parity/steps.md). Step **2.3 = pending-question button affordances** per [`../../UPGRADE/plans/tier-2-channel-parity.md`](../../UPGRADE/plans/tier-2-channel-parity.md) §2.3. Touches `packages/channels/src/discord.ts` `send()` (attach `ActionRowBuilder` with Answer/Skip/Escalate buttons when `msg.metadata.questionId` is set), `packages/channels/src/telegram.ts` `send()` (inline_keyboard via `reply_markup`), and the Telegram poll loop to handle `callback_query` updates alongside messages. Discord side also needs a button-`interactionCreate` branch (in addition to slash). The legacy thread-reply / reply-to-bot answer path stays intact — buttons are additive.

---

## Git state

- **Branch:** main
- **Last commit:** `22e0e54` — feat(2.2): wire Telegram setMyCommands + extract command-handlers.ts
- **Uncommitted changes:** none (working tree clean)
- **Last phase tag:** `phase-1-doc-sweep-closed` (annotated tag at commit `10e400a`)

---

## Open blockers

- None

---

## In-flight work

None. Step 2.2 closed cleanly; 2.3 has not started.

---

## Test / eval status

- **Last test run:** 2026-05-02 — 938 passed, 3 skipped (worker-sandbox Windows-only / Linux-only branches; `describe.skipIf`). Channels package: 103/103 across 5 files.
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness

---

## Recent decisions (last 3 ADRs)

- ADR 0028 — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- ADR 0027 — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)
- ADR 0026 — pluggable-runtime-contract (assessor pluggable across Python / Node / Go / Rust; env-owning vs env-assuming provisioner; failure-mode taxonomy)

No new ADRs decided in this session — the `setProjectBudget` callback shape and the shared `command-handlers.ts` extraction were judgement calls within the tier-2 plan, not architectural decisions.

---

## Recently completed (last 5 steps)

- Step 2.2 — Wire Telegram `setMyCommands` + extract transport-agnostic `command-handlers.ts` shared with Discord; replace `/build` legacy parser with shared `runBuild`; new HTML-mode reply formatter with `<pre>` tables — 2026-05-02 — `22e0e54`
- Step 2.1 — Wire Discord slash commands (`/factory status / spend / findings / resume / cancel / budget / build`); register guild-scoped or global; embed responses; SQLite-direct reads; `setProjectBudget` callback added to `ChannelContext` — 2026-05-02 — `8ea8e4a`
- Phase 1 (doc-sweep) closed + Phase 2 (channel-parity) scaffolded — close commit `1384ae8` (tag `phase-1-doc-sweep-closed` on `10e400a`) — 2026-05-02
- Step 1.8 — tier-1 acceptance prep (mark U001-003/U014-017 resolved in UPGRADE/ISSUES.md; fix orphan factory-inspect ref in packages/logger/README.md) — 2026-05-02 — `10e400a`
- Step 1.7 — reconcile `docs/SKILLS.md` + `docs/AGENTS.md` against current code (add `ask-user` skill row; update 4 agents' Tools + Default-skills columns) — 2026-05-02 — `e75b5dd`

---

## Attempts that didn't work (current step only)

- None yet — Step 2.3 not started.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host

---

## Notes for next session

Phase 2 split, recap: **2a** = 2.1 + 2.2 + 2.3 (slash + setMyCommands + button affordances) — 2.1 + 2.2 done this session; 2.3 is what's left in 2a. **2b** = 2.4 + 2.5 (cancel-kills-workers + 8-intent triage). Step 2.6 (`factory chat` per-turn timeout) is optional and deferrable to Phase 3 if the streaming path wins.

**Step 2.3 design notes** (read before starting):

- The shape is symmetric between transports: when an outbound message has metadata flagging it as a pending-question prompt, attach button affordances. The brain emits the outbound; the channel plugin's `send()` is what attaches the buttons. So the contract change is: the outbound message needs a way to signal "this is a question" + carry the question id.
- Today the plugins look up pending-question rows via `channelRef`-LIKE matching for the answer path; for the outbound side, the brain's outbound emitter doesn't pass extra metadata. Two options: (a) add a `metadata: { questionId }` field to the `OutboundMessage` schema, or (b) have the channel plugin look up "is there an open pending question for this directive?" by directiveId before sending. Option (a) is cleaner — explicit signal beats inferred.
- Discord buttons: `ActionRowBuilder<ButtonBuilder>` with three buttons. CustomIds like `factory:question:<id>:answer`, `factory:question:<id>:skip`, `factory:question:<id>:escalate`. The "Answer" button opens a `ModalBuilder` with a single `TextInputBuilder`; submission lands in `interactionCreate` as a `ModalSubmitInteraction`.
- Telegram inline keyboards: `reply_markup: { inline_keyboard: [[ {text, callback_data} ... ]] }`. Callbacks come back as `update.callback_query` — the poll loop currently only requests `allowed_updates: ['message']`, so it'll need `['message', 'callback_query']`.
- `pendingQuestions.answer(db, id, text, ts)` is the existing call; both flows funnel through it.

**Code-touching surfaces this session (cumulative for Phase 2 so far):**

- `packages/channels/src/{discord,telegram,command-handlers,discord-commands}.ts` — primary
- `packages/channels/src/{registry,types}.ts` — added `setProjectBudget` callback
- `packages/daemon/src/index.ts` — bound `registrySetProjectBudget` over `wiki.updateProjectMetadata`
- All four `pnpm` gates green; full workspace 938 tests pass.

**Live-smoke acceptance still pending** for Phase 2: `/factory <cmd>` against a real Discord bot, `/<cmd>` against a real Telegram bot, with both `setMyCommands`-registered and slash-registered surfaces honoured. Done at `/phase-close` (step 2.7) once 2.3+2.4+2.5 land.

**Hook fix (cleared):** `.claude/hooks/regenerate-next-md.ps1` previously read STATE.md as CP-1252 (default for `Get-Content` on en-US Windows) but wrote UTF-8 with BOM, mangling em-dashes (`—` → `â€"`) and section signs (`§` → `Â§`). Fixed in this session-end commit: `Get-Content -Encoding utf8` + `WriteAllText` with a `UTF8Encoding $false` (no BOM) for parity with the bash sibling. The `next.md` produced by THIS session-end is the first run with the fix.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).
