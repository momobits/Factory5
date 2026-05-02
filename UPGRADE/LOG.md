# Upgrade log

Session-by-session handoff log. Append a new section at the **top** at session end. Most recent entry is what a new session reads first.

Each entry should answer: what was done, what was decided, what's next.

---

## 2026-05-02 — Tier 2 session 2a — Discord slash + Telegram setMyCommands

Closed Phase 2 steps 2.1 and 2.2 — the "structural" half of channel parity. Both Discord and Telegram now expose the brain's eight-intent vocabulary as a native chat surface (slash commands on Discord, `/` autocomplete + `/<cmd>` parser on Telegram); the two transports dispatch through a shared `command-handlers.ts` so future tweaks land in one place.

**Commits this session:**

- `8ea8e4a` feat(2.1): wire Discord slash commands
- `22e0e54` feat(2.2): wire Telegram setMyCommands + extract command-handlers.ts
- `(this commit)` docs(state): session end for step 2.2

**Decisions (judgement calls; no ADRs):**

- **`setProjectBudget` as a `ChannelContext` callback** (not a `@factory5/wiki` import in `@factory5/channels`). Symmetry with `resolveProjectPath` / `resolveBuildLimits`; daemon binds the callback over `wiki.updateProjectMetadata`. Channel plugins stay free of wiki coupling. `SetProjectBudgetError` sentinel with stable codes (`NOT_FOUND` / `AMBIGUOUS` / `PATH_UNREADABLE` / `METADATA_CORRUPT`) so handlers return structured failures rather than throwing.
- **Cancel for 2.1 = `markBlocked`-only.** Step 2.4 will swap in real `AbortController` plumbing + worker SIGTERM/SIGKILL discipline. The slash-command UX-message explicitly notes "2.1 marks the row blocked. Step 2.4 will additionally kill running workers within 10 s." so an operator running a long build during the gap window isn't surprised.
- **Telegram `/build` migrated to the shared `runBuild` handler** (i.e. the legacy `parseBuildPayload` is gone). The directive shape is preserved (project + spec + projectPath + language + limits) — just `payload.text` is dropped (no consumer reads it; one roundtrip-test assertion updated). Unifies the message-driven `/build` path with the `command-handlers.ts` contract.
- **`buildPrefix` config** preserved in the schema for backward compat but no longer load-bearing. Operators who customised it (e.g. `buildPrefix = '!build'`) lose that customisation; canonical trigger is `/build` going forward. Documented in the schema comment.
- **Telegram reply formatting:** HTML mode with `<pre>` blocks for tabular reads (`status` / `spend` / `findings`); plain text for state-changing commands (`build` / `resume` / `cancel` / `budget`). Avoids MarkdownV2's escape-character footgun.
- **Slash-command channelRef shape** for Discord (`discord-slash-<timestamp>`) is acknowledged as not routable for brain outbound replies — known gap, mostly cosmetic for 2.1's confirmation-only UX. Telegram-side uses the existing `<chatId>#<messageId>` shape and reaches the user normally. Revisit when 2.3 lands button affordances and the brain might want to send progress updates back.
- **`payload.text` on chat directives stays.** Only build directives drop it (the brain's chat-intent flow does read `payload.text`).

**Minor fixes:** `.claude/hooks/regenerate-next-md.ps1` UTF-8 round-trip fix landed during the 2.2-2.3 idle window — `Get-Content -Encoding utf8` + `WriteAllText` with a no-BOM `UTF8Encoding $false`. The mojibake on em-dashes (`—` → `â€"`) and section signs (`§` → `Â§`) that the prior session-end worked around manually is now fixed at source.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (938 passed, 3 skipped — Windows/Linux-only worker-sandbox branches; channels package: 103/103)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- Phase 2 progress: 2.1 + 2.2 closed; 2.3 / 2.4 / 2.5 still open. Phase 2 tag (`phase-2-channel-parity-closed`) goes on at step 2.7 once live-smoke acceptance is met.

**Next session pointer:**

- Step **2.3** = pending-question button affordances on Discord + Telegram. Discord: `ActionRowBuilder` with Answer / Skip / Escalate buttons; Answer opens a `ModalBuilder`. Telegram: inline keyboard via `reply_markup`; poll loop expanded to handle `callback_query` updates. Outbound message schema needs a `metadata: { questionId }` field so the channel `send()` can decide to attach buttons. Existing thread-reply / reply-to-bot path stays as the fallback.
- Sessions remaining for Phase 2: 2.3 (this) + a session for 2.4 + 2.5 + phase-close.

---

## 2026-05-02 — Tier 1 (doc-sweep) shipped end-to-end; Tier 2 scaffolded

Closed Tier 1 in a single session. All seven Tier-1 issues (U001-U003 stale READMEs, U014-U015 missing onboarding sections, U016 missing workflows doc, U017 missing CLAUDE.md authoring guide) resolved. Tier 2 (channel parity) scaffolded under `.control/phases/phase-2-channel-parity/`; ready to begin step 2.1 (Discord slash commands) next session.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (876 passed, 3 skipped — Windows/Linux-only worker-sandbox branches)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- 16 issues remain Open across Tiers 2-4

**Recent commits on `main` leading into and through this session:**

- `1384ae8` — `chore(phase-1): close phase 1, kick off phase 2` (tag `phase-1-doc-sweep-closed` on `10e400a`)
- `10e400a` — `docs(1.8): tier-1 acceptance prep — mark U001-003/U014-017 resolved + fix orphan factory-inspect ref`
- `e75b5dd` — `docs(1.7): reconcile SKILLS.md + AGENTS.md against current code`
- `b813037` — `docs(1.6): write docs/WORKFLOWS.md — four canonical loops + decision matrix + CLAUDE.md authoring guide`
- `010843b` — `docs(1.5): add §"Chat — CLI / Discord / Telegram" to ONBOARDING.md`
- `0ffdd8d` — `docs(1.4): add §"Web dashboard" to ONBOARDING.md`
- `30293ff` — `docs(1.3): refresh apps/factory-web/README.md — drop phase-number scaffolding, add page index`
- `c53f8d9` — `docs(1.2): refresh packages/channels/README.md — Telegram and web no longer "future"`
- `d33635a` — `docs(1.1): refresh packages/cli/README.md — drop Phase column, add spend/findings/questions cleanup`
- `91541a9` — `docs(state): reconcile STATE.md + Phase 1 README to actual git state`

**Decisions made this session:**

- Section renumbering in `docs/ONBOARDING.md` (Web-dashboard insertion at §5 + Chat insertion at §6 each bumped subsequent sections by +1) handled with a full Write rather than ~20 surgical Edits — cleaner to read and verify.
- `WORKFLOWS.md` cross-referenced from all four anchor docs (README, CLAUDE, ARCHITECTURE, ONBOARDING), exceeding the Phase 1 done-criterion's 3-doc threshold.
- The query-string-`detail.astro` convention in `apps/factory-web` documented as a deliberate choice (not a TODO) — keeps prod build static so `@fastify/static` mounts without route-rewrite logic.
- `factory inspect` permanently retired from `packages/cli/README.md` and `packages/logger/README.md` (was never shipped, isn't on any tier roadmap). `factory push` permanently retired per ADR 0019.
- Phase tag set on the last work commit (`10e400a`), not on the close commit (`1384ae8`) — tag marks where Phase 1 ends, close commit is administrative.

**What's next:**

Pick **Tier 2 step 2.1** — wire Discord slash commands per [`plans/tier-2-channel-parity.md`](plans/tier-2-channel-parity.md) §2.1. New file `packages/channels/src/discord-commands.ts`; edit `packages/channels/src/discord.ts` to call `client.application.commands.set()` on `Events.ClientReady` and register an `interactionCreate` listener. Embed-formatted responses; **no LLM** for read commands (`status`/`spend`/`findings`).

Phase 2 is the first phase that touches code — confirm Discord + Telegram test bots are configured (`factory doctor`) before starting. Tier-2 plan recommends splitting into 2a (steps 2.1-2.3, slash commands + buttons) and 2b (steps 2.4-2.5, `factory cancel` + 8-intent triage).

---

## 2026-05-02 — Audit + roadmap captured

Frozen the audit and the four-tier upgrade roadmap into this `UPGRADE/` directory. No code changes this session beyond the doc cleanup commits below; the roadmap is the deliverable.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (876 passed, 3 skipped)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- 15 packages, 3 apps, 28 ADRs, ~35.6k LOC of source

**Recent commits on `main` leading into this session:**

- `de17274` — `docs: consolidate to single ARCHITECTURE.md, drop build journal and resolved-issue tracker`
- `f6fb28c` — `chore: remove Control framework workflow`
- `fe5f770` — `chore(phase-15): close phase 15 still-quiet (no sub-steps shipped)` (last pre-cleanup commit)

**Decisions made this session:**

- Keep `docs/decisions/` (ADRs are load-bearing, cited from 150+ inline source comments).
- Removed `docs/issues/` (all 15 RESOLVED; bug-history is in git; design implications are captured in ADRs). Upgrade-time issues now live in [`ISSUES.md`](ISSUES.md).
- This `UPGRADE/` directory is not a Control-framework recreation — no hooks, no auto-snapshots, no slash commands. Just a workspace.
- Tier order: docs → channel parity → web UI → CLI completion. See [`ROADMAP.md`](ROADMAP.md).

**What's next:**

Pick **Tier 1** — the doc sweep. See [`plans/tier-1-doc-sweep.md`](plans/tier-1-doc-sweep.md). It's the shortest, least controversial, and the doc fixes will be cited from later tiers (especially Tier 2's channel responses, which should link to `docs/WORKFLOWS.md`).
