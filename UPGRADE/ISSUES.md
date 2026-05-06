# Issues — upgrade work

Issues discovered during audit + ongoing upgrade work. New issues append to "Open" at the bottom; resolved issues move to "Resolved" at the bottom of the file with a date.

## Format

```markdown
### UNNN — Short title

- **Severity**: low | medium | high | blocker
- **Tier**: 1 | 2 | 3 | 4 | out-of-scope
- **Area**: cli | channels | web | brain | docs | etc.
- **Description**: what's wrong / missing
- **Hypothesis**: best guess at root cause / approach
- **Resolution**: (filled when work begins / completes)
```

Severity:

- **blocker** — actively preventing other work
- **high** — material UX or correctness gap
- **medium** — notable but not load-bearing
- **low** — polish / nice-to-have

## Open

### U005 — `factory chat` REPL turn timeout is 120 s

- **Severity**: medium
- **Tier**: 2 or 4
- **Area**: cli
- **Description**: `packages/cli/src/commands/chat.ts:42` — `TURN_TIMEOUT_MS = 120_000`. For chat directives that route through architect / planner / builder agents, 2 minutes is often too short and the user sees _"(no reply within 2 min — directive may still be running)"_.
- **Hypothesis**: Either (a) increase the timeout to something like 10 min and rely on user `Ctrl-C`, or (b) stream partial responses and the daemon emits intermediate progress messages. Option (b) is the better UX but requires daemon-side support.
- **Resolution**: Tier 2 or 4. Pair with the chat surface work.

### U018 — CLI has no `--help` examples beyond Commander defaults

- **Severity**: medium
- **Tier**: 4
- **Area**: cli
- **Description**: `factory build --help` lists flags but doesn't show worked examples. New operators don't know what a real invocation looks like.
- **Hypothesis**: Use Commander's `addHelpText('after', '...')` per command with a worked invocation.
- **Resolution**: Tier 4.

### U019 — CLI has no tab completion

- **Severity**: low
- **Tier**: 4
- **Area**: cli
- **Description**: Commander supports tab completion via `commander.completion()` or shellcomp. Not wired today.
- **Resolution**: Tier 4 — generate completion for bash / zsh / pwsh; add `factory completion <shell>` install command.

### U020 — CLI has no `factory project ...` command set

- **Severity**: medium
- **Tier**: 4
- **Area**: cli
- **Description**: Project management is implicit (a side-effect of `factory init` and `factory build`). No `factory project list / show <name> / delete <name>`.
- **Resolution**: Tier 4.

### U021 — CLI has no `factory budget set` command (only via flags)

- **Severity**: medium
- **Tier**: 4
- **Area**: cli
- **Description**: Budget changes go through the web UI's `PUT /api/v1/projects/:id/budget`. The CLI has no sibling. Operators must edit `project.json` by hand or use the web UI.
- **Resolution**: Tier 4 — `factory budget set <project> --max-usd <n> [--max-steps <n>]`. Same code path as the web mutation.

## Resolved

### U001 — packages/cli/README.md is stale

- **Severity**: medium
- **Tier**: 1
- **Area**: docs / cli
- **Description**: Has a "Phase" column from the Control era; missing rows for `factory spend`, `factory findings`, `factory questions cleanup` (all shipped); `factory logs` shown as "stub" but is planned-only today; `factory inspect` and `factory push` still listed as planned and may stay that way.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.1, commit `d33635a`. Dropped Phase column; added `spend` / `findings list|show|backfill` / `questions cleanup` rows with per-command sections; removed `inspect` (never shipped) and `push` (ADR 0019 retired GitHub); reworded `logs` row to clarify it's a stub that prints a directory hint.

### U002 — packages/channels/README.md is catastrophically stale

- **Severity**: high
- **Tier**: 1
- **Area**: docs / channels
- **Description**: Said _"`telegram` channel — future (Phase 5+)"_; _"`web` channel — future"_; _"`discord` channel — phase-4 (this release)"_. Telegram is fully shipped (ADR 0022); web is fully shipped (ADRs 0025, 0027); Discord is matured beyond phase-4. Doc misled any reader trying to understand the channel layer.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.2, commit `c53f8d9`. Rewrote Status section to reflect what's shipped (`cli-rpc`, `discord`, `telegram` are all shipped; web UI is a Fastify mount, not a `ChannelPlugin`); added Telegram plugin section mirroring the Discord one; added "Web — not a `ChannelPlugin`" section that explicitly calls out the boundary.

### U003 — apps/factory-web/README.md has minor staleness

- **Severity**: low
- **Tier**: 1
- **Area**: docs / web
- **Description**: Referenced "(wired in 9.3)" — phase-number scaffolding from Control era. Otherwise OK.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.3, commit `30293ff`. Dropped the `(wired in 9.3)` parenthetical and reworded the Auth section to describe what `factory ui-token` does. Replaced the placeholder Routing section with a Pages table mapping URL → file → purpose for all ten SPA pages.

### U014 — No `docs/ONBOARDING.md` section for the web UI

- **Severity**: high
- **Tier**: 1
- **Area**: docs
- **Description**: Dashboard URL was printed once at daemon startup and never explained in onboarding. New operators didn't discover the dashboard.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.4, commit `0ffdd8d`. Added §5 "Web dashboard" with subsections covering open / recover URL / page tour / today's limitations; renumbered Discord / Telegram / multi-instance / backups / troubleshooting from §5–§9 to §6–§10 with inline §-reference updates; added two dashboard troubleshooting bullets and ADRs 0025 + 0027 to the Pointers section.

### U015 — No `docs/ONBOARDING.md` section for `factory chat`

- **Severity**: high
- **Tier**: 1
- **Area**: docs
- **Description**: The most natural ongoing-use surface (a REPL) had zero onboarding mention. New users who didn't pick up Discord/Telegram never discovered it.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.5, commit `010843b`. Added §6 "Chat — CLI / Discord / Telegram" with subsections for `factory chat` (sample transcript, `/quit`, 120 s timeout), Discord chat (mention → thread → `/build`), Telegram chat (DM-vs-group, reply-to-bot for pending questions), and the shared-Directive model that lets a conversation cross surfaces. Renumbered remaining sections by +1 with inline §-ref updates.

### U016 — No `docs/WORKFLOWS.md` exists

- **Severity**: high
- **Tier**: 1
- **Area**: docs
- **Description**: No canonical "this is how you use factory5" doc. Four loops (one-shot autonomous, chat-driven, fix loop, resume after pause) were unspecified. No decision matrix for "when do I use which surface?".
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.6, commit `b813037`. Wrote `docs/WORKFLOWS.md` with §1 four canonical loops (each with a worked example), §2 surface decision matrix ("best for" + "avoid for" per surface), §3 CLAUDE.md authoring guide (see U017), and §4 see-also pointers. Added cross-references from `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `docs/ONBOARDING.md` (4 of 4 anchor docs; the Phase 1 done-criterion required at least 3).

### U017 — No CLAUDE.md authoring guide

- **Severity**: medium
- **Tier**: 1
- **Area**: docs
- **Description**: factory consumes `<workspace>/<project>/CLAUDE.md` as the spec, but there was no doc explaining what makes a good spec. New users guessed.
- **Resolution**: Resolved 2026-05-02 — Tier 1 step 1.6, commit `b813037`. Folded into `docs/WORKFLOWS.md` §3 ("Authoring `CLAUDE.md` — what makes a good spec") with principles, anti-patterns, a worked 30-line example for a small CLI tool, and a brief "what the brain does with it" walkthrough mapping to the triage→architect→plan→assess→verify loop.

### U004 — `factory cancel` does not exist; `mark-blocked` is the workaround

- **Severity**: high
- **Tier**: 2 (brain hook + IPC route + CLI command)
- **Area**: cli / brain
- **Description**: A running build can only be stopped via `factory directive mark-blocked <id>`, which flips the directive status to `blocked` but does not signal the worker pool to abort tasks. Workers continue burning budget until they finish or hit their own limits.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.4, commit `67fb998`. Shipped `factory cancel <id>` end-to-end: state-side `cancelDirective` flips the row to `failed` with `blocked_reason = 'cancelled'`, brain registers a per-directive `AbortController` registered at claim time and fired by the daemon's new `POST /directives/:id/cancel` route, the existing pool→worker→provider abort plumbing kills the `claude -p` subprocess (SIGTERM-then-SIGKILL with a 5 s grace), and the worker's worktree cleanup gained a `cancelled` outcome that removes the worktree without merging. CLI is IPC-first with a DB-direct fallback when the daemon's down. `factory directive mark-blocked` docstring updated to call out the distinction.

### U011 — Discord plugin schema reserves `applicationId` for slash commands but never wires them

- **Severity**: high
- **Tier**: 2
- **Area**: channels / discord
- **Description**: `packages/channels/src/discord.ts:69` — `applicationId` is in the config schema with comment _"used by future slash-command wiring"_. Today the field is read but never used. Discord users see only `@bot /build` mentions, not native slash-command autocomplete.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.1, commit `8ea8e4a`. `client.application.commands.set([factorySlashCommand], guildId?)` runs on `Events.ClientReady`; guild-scoped when `config.guildId` is set, global otherwise. `interactionCreate` dispatches the seven subcommands (`status / spend / findings / resume / cancel / budget / build`) via the shared `runSubcommand` → `embed<Cmd>` pipeline that 2.2 then split into `command-handlers.ts`.

### U012 — Telegram does not call setMyCommands

- **Severity**: high
- **Tier**: 2
- **Area**: channels / telegram
- **Description**: Telegram supports a bot-command menu via the `setMyCommands` API. factory5's Telegram plugin doesn't call it. The Telegram `/` autocomplete shows nothing for the bot.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.2, commit `22e0e54`. `start()` calls `setMyCommands` with the seven-command list shared with Discord (`FACTORY_TELEGRAM_COMMANDS`); the parser dispatches `/cmd args` through the new transport-agnostic `command-handlers.ts` module so Discord and Telegram can never drift. HTML `<pre>` tables for tabular replies (status, spend, findings).

### U013 — No inline-keyboard / button affordances for pending-question UX

- **Severity**: medium
- **Tier**: 2
- **Area**: channels / discord / telegram
- **Description**: Pending-question round-trip is plain text on both Discord and Telegram. Discord supports buttons; Telegram supports inline keyboards. _"Answer / Skip / Escalate"_ buttons would be a meaningful UX upgrade.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.3, commit `682afd3`. Brain already stamps `metadata: { kind: 'ask_user', questionId }` on `ask_user` outbounds; channel `send()` reads the metadata and attaches buttons (`ActionRowBuilder` for Discord, `reply_markup.inline_keyboard` for Telegram). Discord Answer button opens a `ModalBuilder`; modal submit records the operator-typed text. Telegram poll loop widens `allowed_updates` to `['message','callback_query']`; Skip/Escalate write synthetic answers; Answer fires `answerCallbackQuery` directing the operator to use Telegram's native Reply feature (existing reply path then routes the answer). The legacy thread-reply / reply-to-bot answer path is preserved as a fallback.

### U023 — Brain triage routes channel chat to `intent=chat` rather than the eight-intent vocabulary

- **Severity**: high
- **Tier**: 2
- **Area**: brain / channels
- **Description**: The brain understands `build / fix / review / investigate / chat / status / resume / cancel`. Today, channel-originated chat (Discord thread reply, Telegram DM) becomes `intent=chat` regardless of content. A user asking _"what's the budget?"_ in Telegram gets a chat-intent LLM round-trip rather than a structured status response.
- **Resolution**: Resolved 2026-05-02 — Tier 2 step 2.5, commit `72c45e3`. Triage prompt expanded with 8-intent guidance, ten worked examples, and the `<0.7` confidence floor for non-chat. New `ChannelContext.classifyIntent` callback bound by the daemon to `brain.triageDirective`. Channel handlers (Discord + Telegram) call `routeChatIntent` which maps `status` (+ keyword pass for spend/findings) → `runStatus`/`runSpend`/`runFindings`, and `resume` (+ project token extract) → `runResume`. `cancel` stays explicit-only (needs a ULID); `build`/`fix`/`review`/`investigate`/`chat` fall through to the legacy chat-directive path. Intent enum kept at 8 to avoid a SQLite CHECK-constraint migration; the channel-side keyword sub-router picks spend vs findings within `intent=status`.

### U006 — Web UI directive detail has no live updates

- **Severity**: high
- **Tier**: 3
- **Area**: web
- **Description**: After kicking off a build, the SPA redirects to `directives/detail?id=...`. The page loads once and never refreshes. Tasks transitioning, findings appearing, spend ticking up — none of it is visible without a manual reload.
- **Resolution**: Resolved 2026-05-06 — Tier 3 step 3.1 (route/hub) + 3.2 (page wiring), `phase-3-web-ui-closed`. SSE on `GET /api/v1/directives/:id/stream` with six event types (`task.started/completed`, `finding.created`, `spend.updated`, `log.line`, `directive.completed`); per-directive `DirectiveStreamHub` subscription map, 15 s `:keepalive` heartbeats, backfill burst on connect that makes connect-after-build idempotent. `directives/detail.astro` consumes via `EventSource` with token-via-`?t=` accommodation; polling fallback for SSE-stripped proxies. ADR 0029 pins the protocol; live-verification record completed in 3.7's `node-sse-smoke` build (six event types confirmed end-to-end).

### U007 — Web UI has no chat surface

- **Severity**: high
- **Tier**: 3
- **Area**: web
- **Description**: To talk to the brain conversationally, the operator must drop to `factory chat` (terminal) or use Discord/Telegram. The dashboard has zero conversational affordance.
- **Resolution**: Resolved 2026-05-06 — Tier 3 step 3.5, `phase-3-web-ui-closed`. New `apps/factory-web/src/pages/chat.astro` mirrors `factory chat` end-to-end against a real factoryd; new `POST /api/v1/chat/messages` route mints `intent=chat` directives; the page subscribes to the same SSE stream from 3.1 for token-by-token reply rendering. Slash-prefixed reads (`/status`, `/spend`, `/findings`) re-route through Phase 2's shared `command-handlers.ts` so Discord, Telegram, and web-chat never drift.

### U008 — Web UI uses `el()` builder pattern instead of Astro components

- **Severity**: medium
- **Tier**: 3
- **Area**: web
- **Description**: Each page in `apps/factory-web/src/pages/` hand-builds DOM with `mount.appendChild(el('div', {}, ...))`. No shared components; no reuse beyond the `el()` helper in `lib/api.ts`. Astro's component model is not used.
- **Resolution**: Resolved 2026-05-03 — Tier 3 step 3.3 (component library) + 3.4 (page conversion), commit `dfd1a07` closed 3.4. Astro component library shipped: `<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<Field>`, `<Submit>`, `<PageShell>`. All 10 pages converted; `el()` and `loadInto()` retired from `lib/api.ts`. Migration map covered list pages, detail pages, the build form, and `directives/detail`'s per-page DOM helper for the live SSE render path. Dashboard's class-based primitives (`.btn*`, `.alert*`, `.form-*`, table base) survive intentionally — slot-content scoping discovery captured in `apps/factory-web/src/components/README.md`; full PageShell adoption + `<style is:global>` migration deferred to Phase 4.

### U009 — Web UI has no mobile-specific design

- **Severity**: medium
- **Tier**: 3
- **Area**: web
- **Description**: `Dashboard.astro` has horizontal nav with no responsive collapse; tables and forms aren't tested below ~600 px. `viewport` meta is set but layout doesn't adapt.
- **Resolution**: Resolved 2026-05-05 — Tier 3 step 3.9, commit `5a15b1a`. `Dashboard.astro` gains a `<details>`-based hamburger drawer at ≤768px (zero JS, native a11y, keyboard- and screen-reader-friendly); 44×44px tap target per Apple HIG; `@media (max-width: 640px)` stacks paired-column `.form-row` to single column; `Table.astro` wraps `<table>` in a `.table-wrap` div with `overflow-x: auto` for horizontal scrolling on wide data tables. Operator visual verification across desktop, ≤768px, 375px (iPhone SE), <640px breakpoints + keyboard nav + light/dark.

### U010 — Web UI sessionStorage token UX is fragile

- **Severity**: low
- **Tier**: 3
- **Area**: web
- **Description**: Token in `sessionStorage` survives reload but dies on tab close. No explicit logout. No "your session is fresh" indicator. If the operator closes the tab they have to re-fetch the URL via `factory ui-token`.
- **Resolution**: Resolved 2026-05-05 — Tier 3 step 3.10, commits `d544192` (feat) + `3cecb72` (follow-up fix). Header gains a connection-status pip + Sign out button; layout-level heartbeat (30 s poll on `/api/v1/status`) drives the pip across all pages; state machine 0 failures → green `Connected` / 1-2 → amber `Reconnecting…` / 3+ → red `Disconnected`; no token in store → red `Signed out`. Theme-independent traffic-light colors (`#2a8` / `#d80` / `#c24`); `aria-live="polite"` announces transitions. Logout flow: `clearToken()` + redirect to `/app/?logged-out=1`; logged-out banner unhides on the URL param then strips it via `history.replaceState`. Stale-token (401) short-circuits to red `Session expired` with a hover tooltip naming `factory ui-token` as the recovery command — error-class differentiation that the generic 3-failure cycle hid.

### U022 — `el()` helper does not escape `setAttribute` arguments

- **Severity**: low
- **Tier**: 3 (folded into the component refactor)
- **Area**: web
- **Description**: `apps/factory-web/src/lib/api.ts:158` — `e.setAttribute(k, v)` is called with raw values from object spreads. Text content is safe (uses `createTextNode`), but attributes are not escaped. Today the only attribute values come from server-trusted strings, so practical risk is low. Still: not a robust pattern.
- **Resolution**: Resolved 2026-05-03 — Tier 3 step 3.4, commit `dfd1a07`. `el()` retired from `lib/api.ts` as part of the 10-page component conversion; the unsafe `setAttribute(k, v)` callsite no longer exists. Component primitives (`<Card>`, `<Table>`, `<Alert>`, `<Form>`, etc.) encode safe rendering by construction (Astro auto-escapes interpolated values).
