# Upgrade log

Session-by-session handoff log. Append a new section at the **top** at session end. Most recent entry is what a new session reads first.

Each entry should answer: what was done, what was decided, what's next.

---

## 2026-05-05 — Phase 3 step 3.7 code-complete (createProject extraction → POST route → /app/projects/new page)

Step 3.7 ships its three code commits this session, plus a session-start drift reconcile. The `/app/projects/new` page closes the SPA's last hand-rolled-in-CLI gap from ADR 0027 §3.7 — operators can scaffold a project from the dashboard end-to-end without a terminal. Behaviour-preserving for `factory init <name>` (CLI thin-wrapped over the same `wiki.createProject` extraction).

**Commits (4 in this session, post-`1c6eeaf`):**

- `317d94b` `docs(state): reconcile STATE.md last-commit pointer to current HEAD` (sixth occurrence of the post-session-end self-reference drift after `cce7065` / `db61baf` / `54c0f20` / `d7a366c` / `288603e`; STATE.md "Last commit" caught up from `79474b1` (ADR 0029) to `1c6eeaf` (prior session-end docs); same `288603e`-shape — accepts the steady-state lag-by-1 the runbook documents).
- `d118e1c` `refactor(3.7): extract createProject into @factory5/wiki` — new `wiki.createProject({projectPath, name, language, claudeMd?}) → {id, path, claudeMdPath}` containing `runProjectInit`'s body (refuse-overwrite + mkdir + writeFile + loadOrCreateProjectMetadata); new `CreateProjectAlreadyExistsError` with reason union for CLI exit-2 / daemon 409 fan-out; `scaffoldClaudeMd` relocated to wiki (single source of truth); CLI's `runProjectInit` thin-wrapper rewrite (~30 LOC); init.test.ts deleted, its 4 scaffold tests reproduced in wiki + 6 new createProject tests added. Wiki 64 → 74, CLI 82 → 78.
- `50e8b33` `feat(3.7): POST /api/v1/projects route + schemas` — `apiV1CreateProject{Request,Response}Schema` in `@factory5/ipc`; daemon route gated by `requireUiAuth` mirrors the 3.6 cancel-route auth pattern; pipeline parses → joins workspace + name → wiki.createProject (maps already-exists → 409) → upserts registry row; new `IpcServerOptions.workspace?` opt for test override + future config-driven prod use; +6 route tests covering 401/503/400-missing-name/400-bad-language/happy-path/409-already-exists. Daemon 167 → 173.
- `53e4e98` `feat(3.7): /app/projects/new page` — `apps/factory-web/src/pages/projects/new.astro` modeled on `build.astro`'s `<Form>+<Field>+<Submit>` shape; fields are name (required) + language (required, python default) + optional CLAUDE.md textarea; on 200 redirects to `/app/projects/detail?id=<id>`; hidden-`<Alert>`-placeholder pattern surfaces inline errors (ALREADY_EXISTS / SCHEMA_VALIDATION_FAILED / UI_AUTH_REQUIRED / UI_DISABLED). `+ New project` affordance added to `projects/index.astro`; empty-state copy updated. Frontend-design skill invoked per saved feedback. Top nav left at 8 items intentionally — `+ New project` on the projects list page covers discoverability without crowding the global nav (intentional deviation from plan's nav-link recommendation, in the lighter direction).

**Design discoveries (recorded in this session's commit bodies + STATE.md notes):**

- **Daemon route cleanly accepts a test-override workspace.** `IpcServerOptions.workspace?` enables tests to scope filesystem side effects via `mkdtemp`. Production factoryd doesn't currently pass it (POST /api/v1/builds has the same gap — `defaultWorkspace()` direct call); the wiring of `cfg.general.workspace` through to IpcServerOptions can land any time and would be picked up by both routes simultaneously. Filed as deferred prod-config wiring; not blocking any 3.x step.
- **The CLI's existing absolute / relative / workspace-rooted path resolution is CLI-only.** The daemon route doesn't honour absolute / relative paths in `name` — operators on the web flow trust the daemon's workspace config and can't sidestep it. Documented in the request schema's TSDoc.
- **`readProjectMetadata` swallow-corruption-as-undefined is preserved in the wiki API.** `runProjectInit`'s `.catch(() => undefined)` semantics carry into `wiki.createProject` for behaviour parity. The `ProjectMetadataCorruptError` then re-surfaces from `loadOrCreateProjectMetadata` further down — slightly different error path but operator-equivalent. Tightening this is filed as latent ergonomic work.

**Decisions / judgement calls during 3.7 worth recording (no new ADR):**

- **Budget fields excluded from `apiV1CreateProjectRequestSchema`.** The plan speculatively included `maxUsd?` / `maxSteps?`; on closer read, the existing `PUT /api/v1/projects/:id/budget` route is the canonical surface for budget defaults (it has full RFC-9110 PUT semantics already). Keeping create minimal mirrors the CLI's two-step flow (`factory init` then `factory build --max-usd …`) and reduces test surface for this commit. Operators can chain create-then-set-budget client-side if a one-form UX wins later.
- **No nav link addition for `/app/projects/new`.** Plan recommended adding "New project" between "Projects" and "Build" in the dashboard nav. On reflection, that would push to 9 nav items (already 8) and a creation flow is contextually accessed from the projects list — the `+ New project` affordance on `projects/index.astro` plus the deep-link from the empty-state alert covers discoverability without nav clutter. Lighter direction.
- **3.7 close commit deferred** (matches the multi-commit-step pattern set by `dfd1a07` (3.4 close) and `0f5775a` (3.6 close)). The `- [ ] 3.7` checkbox flip + ROADMAP tick land in a separate `refactor(3.7): close step 3.7` commit alongside the live-smoke acceptance — keeps the close commit's diff aligned with the acceptance evidence.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (state 152, channels 175, daemon **173**, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki **74**, cli **78**, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. Total **1075 passing**, +12 from 1063 baseline.)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- Phase 3 progress: 3.1 / 3.2 / 3.3 / 3.4 / 3.5 / 3.6 closed; 3.7 code-complete (steps.md checkbox not yet flipped); 3.8 / 3.9 / 3.10 / 3.11 still open. Phase 3 tag (`phase-3-web-ui-closed`) goes on at step 3.11 after acceptance.

**What's next:**

1. **Live-smoke step 3.7** against a restarted factoryd (the long-running daemon on `127.0.0.1:25295` is the pre-3.7 build and 404s the new POST /api/v1/projects route — confirmed via curl). `factory daemon stop && factory daemon start` to pick up commit (b)'s route. Open `/app/projects/new`, submit a real project (recommend a non-trivial one that produces verifier findings — the prior session's `add(a, b)` smoke produced none, missing the `finding.created` live-verification gap pinned in ADR 0029). Verify scaffolded files + redirect + project visibility at `/app/projects/`. Kick a build at `/app/build`; watch `directives/detail` SSE for `finding.created` events.
2. **Close commit** `refactor(3.7): close step 3.7` flips `- [ ] 3.7` → `- [x] 3.7` in `phase-3-web-ui/steps.md` and ticks the matching item in `UPGRADE/ROADMAP.md`. Same shape as `dfd1a07` / `0f5775a`.
3. **Step 3.8** — Spend page charts (sparkline per project + 30-day stacked bar, vanilla SVG) per `plans/tier-3-web-ui-live-and-complete.md` §3.8.

Carry-forward bugs / cleanup (not blocking 3.7 close or 3.8): Submit-button-invisible `.btn-primary { color: Canvas }` will repro on the new form (one-line CSS or fold into the `<style is:global>` migration follow-up); Control framework repo uncommitted edits at `G:\Projects\Small-Projects\Control` (operator's go for 2.2.3 publish); smoke residue cleanup from prior session.

---

## 2026-05-03 — Phase 3 step 3.4 closed (all 10 pages → component library; el() retired)

Step 3.4 shipped this session run — the longest sub-step in Phase 3. Every page in `apps/factory-web/src/pages/` now consumes the Astro component library shipped in 3.3 (`<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<Field>`, `<Submit>`); `el()` and `loadInto()` retired from `lib/api.ts`. Tier 3 ROADMAP item flipped.

**Commits (8 in this session, post-`4466078`):**

- `54c0f20` `docs(state): reconcile STATE.md last-commit pointer to current HEAD` (third occurrence of the post-session-end self-reference drift; first attempt to self-reference via `git commit --amend` reproduced the drift because amend changes the SHA — soft-reset and recommitted following the established `db61baf` shape that points "Last commit" at the session-end commit and the "State reconcile" entry at the prior reconcile)
- `32bdfb6` `refactor(3.4): convert index.astro to <Card> components` (introduces the `id?` extension on Card for the runtime-fetch placeholder pattern)
- `d55c41d` `refactor(3.4): convert findings list page to <Table>; extend Table with id?/loading?` (Table extension: `loading={true}` renders chrome + colspan'd "Loading…" row instead of falling through to the empty-message branch — realises the components/README.md's "render with `rows={[]}` server-side and append `<tr>` rows from the script" pattern that Table couldn't actually do pre-3.4)
- `a876608` `refactor(3.4): convert projects/questions/spend list pages to <Table> + <Alert>` (projects empty-state hits dedicated `<Alert kind="info">` per migration map; spend page's four sub-tables share a per-page `fillTable<T>` helper)
- `e849aa7` `refactor(3.4): convert directives list + project/question detail pages` (introduces the hidden-Alert-placeholder pattern for dynamic conflict/success swapping; conditional answer-form-wrapper for questions/detail)
- `58d4584` `refactor(3.4): convert build.astro to <Form> + <Field> + <Submit>` (the primary form use case; project select `options={[]}` server-side + script appends one `<option>` per fetched project + rewrites the placeholder hint)
- `a405556` `refactor(3.4): inline el() helper into directives/detail.astro` (the live SSE render path's per-page DOM helper exception per the migration map's "or a per-page helper if the page genuinely needs a wrapper" clause)
- `dfd1a07` `refactor(3.4): retire el() + loadInto() from lib/api.ts; close step 3.4` (flips `[ ] 3.4` → `[x] 3.4` in steps.md and ROADMAP.md; documents the Dashboard-CSS scoping discovery and the deferred PageShell decision in components/README.md)

**Design discoveries (recorded in `apps/factory-web/src/components/README.md`):**

- **Astro scoped CSS does not propagate to slot content.** Dashboard's class-based rules (`.cards`, `.card`, `.empty`, `.err`, `.btn*`, `.alert*`, `.form-*`, `table`/`th`/`td`) survive 3.4 intentionally — they only ever matched elements rendered directly inside Dashboard's own template (the `<header class="shell">` chrome and inner `<h2>`), so they were already inert for slot content. Pruning would not visually regress anything; leaving them in place keeps the door open for a future `<style is:global>` adoption that would let the layout actually style slot-level elements without per-page repetition.
- **`<PageShell>` adoption deferred.** Optional structural sugar; not required by §3.4 acceptance. Wiring it across all 10 pages couples to removing Dashboard's inner `<h2>` (otherwise pages get double `<h2>`s), which would land cleanest in the same focused follow-up step that adopts `<style is:global>` for the Dashboard primitives. Filed as 3.x backlog.
- **`<Card>` and `<Table>` `id?` / `loading?` extensions** were the load-bearing pattern for runtime-fetched data. Server-render with placeholder values + stable `id`; script populates inner cells (`#card-X .value`) or replaces tbody (`#tbl-X tbody`) on `apiFetch` resolution. Empty results from the fetch render a single colspan'd `<tr><td class="empty">` row inside the table so column headers stay visible. Both extensions are non-breaking and documented in components/README.md alongside their static-data counterparts.

**Decisions / judgement calls during 3.4 worth recording (no new ADR):**

- **Filter forms (`<form class="filter-form">`)** stay as inline HTML — they're a horizontal toolbar, not the heavy `<Form>` grid layout. Per the migration map, only `<form class="form">` converts to `<Form>` + `<Field>`.
- **Hidden-Alert-placeholder pattern** for dynamic alerts (conflict/success swapping inside detail pages and the build form): server-render a `<Alert>` with empty `title=""` `body=""` inside a `<div hidden>`; the script reveals via `hidden=false` and writes textContent into the inner `<h4>`/`<p>`. Avoids dynamic class manipulation (which wouldn't pick up Astro's scoped `.alert--conflict[data-astro-cid-X]` selector anyway) and keeps the script free of `<div class="alert alert--conflict">` building.
- **`<Submit>` is type=submit by design.** The projects/detail "Clear all defaults" button stays a raw `<button type="button" class="btn btn-danger">` because it has its own click handler distinct from form submit. Dashboard's global `.btn*` rules survive the prune partly because of this — though see the scoping discovery above; the rules are nominally "global" but in practice scoped, so the visual fate of raw buttons is one of the questions the future `<style is:global>` follow-up answers.
- **`loadInto()` retirement** (not in the migration map; called out here because it was unused after the conversion). The new pattern is direct `apiFetch` + `then`/`catch` with a server-rendered `<p id="error" class="err" hidden>` region above the content; `loadInto` no longer fit because it expected a single mount element to wipe and refill, and the new pages have a distributed mount (table tbody + error region + count paragraph + form fields).

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (state 152, channels 175, daemon 152, brain 93, worker 38, worker-sandbox 86+3 skipped, assessor 79, wiki 64, cli 82, providers 39, ipc 28, events 3 — baseline holds; 3.4 added zero test files)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- Phase 3 progress: 3.1 / 3.2 / 3.3 / 3.4 closed; 3.5 / 3.6 / 3.7 / 3.8 / 3.9 / 3.10 still open. Phase 3 tag (`phase-3-web-ui-closed`) goes on at step 3.11 once acceptance criteria for the remaining steps are met.

**What's next:**

Step **3.5** = `/app/chat` page (browser mirror of `factory chat`) per [`plans/tier-3-web-ui-live-and-complete.md`](plans/tier-3-web-ui-live-and-complete.md) §3.5. Three new surfaces: `apps/factory-web/src/pages/chat.astro` (history + composer + markdown-rendered replies + auto-scroll-with-pause); `POST /api/v1/chat/messages` route in `packages/daemon/src/server.ts` minting an `intent=chat` directive whose SSE stream the page subscribes to; request/response shapes in `packages/ipc/src/schemas.ts`. Reuses Phase 2's `command-handlers.ts` for the optional `/cmd` shortcut path (web-typed `/status` / `/spend` / `/findings` hit the same handler set Discord/Telegram chat does). Carries the Step 2.6 `factory chat` per-turn timeout fix implicitly (streaming partial daemon-side progress eliminates the 120 s false-timeout for chat the same way it did for builds in 3.2).

Pre-requisite: the deferred `log.line` brain emission from Step 3.1 needs to land for 3.5 to render replies (one bubble per agent message). Either pin as part of 3.5's scope or a 3.5-prerequisite mini-step.

---

## 2026-05-03 — Phase 2 (channel-parity) closed; Phase 3 (web-ui) kicked off

Phase 2 shipped end-to-end this session run. Steps 2.3 (pending-question button affordances), 2.4 (`factory cancel` kills workers), 2.5 (8-intent triage + channel re-routing) all landed; 2.6 deferred to Phase 3 (folded into the SSE work). Plus an out-of-step fix that caught a UX gap once channels went live: `/status` output across CLI, Discord, and Telegram now includes a project column so operators can tell which directive belongs to which project.

**Live-smoke run (this session):**

- Discord `/factory status / spend / findings` — embeds render correctly with new project column.
- Telegram `/status / spend / findings` — HTML replies render correctly with new project column.
- Discord chat re-routing — `@Factory what's running right now?` classifies as `intent=status` (confidence 0.98), dispatches to status command. Message-handler gate (require @-mention or in-thread) is correct Discord etiquette and does not block phase close.
- Telegram chat re-routing — free-form text in private chat classifies as `intent=status` (confidence 0.98), dispatches to status command.
- `factory cancel` IPC route paths (NOT_FOUND 404 / ALREADY_TERMINAL 409 / OK 200) verified via synthetic running-directive in DB; CLI exit codes 0/2/3 verified end-to-end.
- Discord registers `/factory` slash guild-scoped at `1495163534433325171` (bot `Factory#5957`).
- Telegram registers `setMyCommands` with 7 entries (bot `Factory5_bot`).
- Build/test/lint/format all green.

**Skipped (intentionally — no live build available):**

- Pending-question button affordances live-smoke. Covered by 18 Discord + 19 Telegram unit tests.
- `factory cancel` killing a real worker subprocess. Covered by 30 unit tests across pool / registry / state / daemon / CLI.

**Issues closed:** U004, U011, U012, U013, U023.

**Notable artifacts produced:**

- Tag `phase-2-channel-parity-closed` (annotated, on `081b832`) with full shipping summary.
- Phase 3 scaffold: `.control/phases/phase-3-web-ui/{README.md, steps.md}`. Carry-forward for Step 2.6 lands in Phase 3's "Why this phase exists" section.
- Phase 2's `command-handlers.ts` is the cross-surface reuse anchor — Phase 3's `/app/chat` page can call into it for read-side dispatch.

**Decisions / judgement calls during Phase 2 worth recording (no new ADR):**

- `OutboundMessage.metadata.questionId` (option A) chosen over inferred lookup by directiveId (option B) for Step 2.3 — explicit signal beats inferred.
- Per-directive `AbortController` registry in `packages/brain/src/cancellation.ts` for Step 2.4 — bridges parent abort + operator cancel into a single combined signal.
- SIGTERM-then-SIGKILL with 5 s grace via `softKill` helper (Step 2.4) — preferable to immediate SIGKILL for clean Claude subprocess shutdown.
- Intent enum kept at 8 (not extended) — avoids a SQLite CHECK-constraint migration; channel-side keyword sub-router picks spend vs findings within `intent=status`.

**What's next:**

Phase 3 (web-ui). Step 3.1 = SSE on `/api/v1/directives/:id/stream` per [`plans/tier-3-web-ui-live-and-complete.md`](plans/tier-3-web-ui-live-and-complete.md) §3.1. Carries the 2.6 streaming benefit for `factory chat` along with it.

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
