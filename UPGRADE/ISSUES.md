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

### U004 — `factory cancel` does not exist; `mark-blocked` is the workaround

- **Severity**: high
- **Tier**: 2 (brain hook + IPC route + CLI command)
- **Area**: cli / brain
- **Description**: A running build can only be stopped via `factory directive mark-blocked <id>`, which flips the directive status to `blocked` but does not signal the worker pool to abort tasks. Workers continue burning budget until they finish or hit their own limits.
- **Hypothesis**: Add `POST /directives/:id/cancel` IPC route; brain calls existing AbortSignal plumbing on the worker pool to cancel in-flight tasks; status flips to `failed` with `blocked_reason: 'cancelled'`. CLI gets a thin wrapper.
- **Resolution**: Tier 2 / Tier 4 (shared code path).

### U005 — `factory chat` REPL turn timeout is 120 s

- **Severity**: medium
- **Tier**: 2 or 4
- **Area**: cli
- **Description**: `packages/cli/src/commands/chat.ts:42` — `TURN_TIMEOUT_MS = 120_000`. For chat directives that route through architect / planner / builder agents, 2 minutes is often too short and the user sees _"(no reply within 2 min — directive may still be running)"_.
- **Hypothesis**: Either (a) increase the timeout to something like 10 min and rely on user `Ctrl-C`, or (b) stream partial responses and the daemon emits intermediate progress messages. Option (b) is the better UX but requires daemon-side support.
- **Resolution**: Tier 2 or 4. Pair with the chat surface work.

### U006 — Web UI directive detail has no live updates

- **Severity**: high
- **Tier**: 3
- **Area**: web
- **Description**: After kicking off a build, the SPA redirects to `directives/detail?id=...`. The page loads once and never refreshes. Tasks transitioning, findings appearing, spend ticking up — none of it is visible without a manual reload.
- **Hypothesis**: Add `GET /api/v1/directives/:id/stream` SSE endpoint emitting NDJSON for `task.started` / `task.completed` / `finding.created` / `spend.updated` / `log.line`. SPA subscribes on page load and appends rows live.
- **Resolution**: Tier 3 (SSE stream + page wiring).

### U007 — Web UI has no chat surface

- **Severity**: high
- **Tier**: 3
- **Area**: web
- **Description**: To talk to the brain conversationally, the operator must drop to `factory chat` (terminal) or use Discord/Telegram. The dashboard has zero conversational affordance.
- **Hypothesis**: New `/app/chat.astro` page; new `POST /api/v1/chat/messages` route that creates `intent=chat` directives; SSE on the same directive stream for replies. Markdown-rendered history.
- **Resolution**: Tier 3.

### U008 — Web UI uses `el()` builder pattern instead of Astro components

- **Severity**: medium
- **Tier**: 3
- **Area**: web
- **Description**: Each page in `apps/factory-web/src/pages/` hand-builds DOM with `mount.appendChild(el('div', {}, ...))`. No shared components; no reuse beyond the `el()` helper in `lib/api.ts`. Astro's component model is not used.
- **Hypothesis**: Build a small component library (`<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>` primitives, `<Layout>`); replace `el()` calls page-by-page; retire `el()`.
- **Resolution**: Tier 3.

### U009 — Web UI has no mobile-specific design

- **Severity**: medium
- **Tier**: 3
- **Area**: web
- **Description**: `Dashboard.astro` has horizontal nav with no responsive collapse; tables and forms aren't tested below ~600 px. `viewport` meta is set but layout doesn't adapt.
- **Resolution**: Tier 3 — hamburger / drawer nav at narrow widths; stacked form rows.

### U010 — Web UI sessionStorage token UX is fragile

- **Severity**: low
- **Tier**: 3
- **Area**: web
- **Description**: Token in `sessionStorage` survives reload but dies on tab close. No explicit logout. No "your session is fresh" indicator. If the operator closes the tab they have to re-fetch the URL via `factory ui-token`.
- **Hypothesis**: Optional `localStorage` mode; add `factory ui-token --rotate` to invalidate prior sessions; add a "Connected to factory5" strip in header.
- **Resolution**: Tier 3.

### U011 — Discord plugin schema reserves `applicationId` for slash commands but never wires them

- **Severity**: high
- **Tier**: 2
- **Area**: channels / discord
- **Description**: `packages/channels/src/discord.ts:69` — `applicationId` is in the config schema with comment _"used by future slash-command wiring"_. Today the field is read but never used. Discord users see only `@bot /build` mentions, not native slash-command autocomplete.
- **Hypothesis**: On `ClientReady`, call `client.application.commands.set([...])` with the slash-command list; add a `interactionCreate` listener that dispatches by command name.
- **Resolution**: Tier 2 — wire `/factory status / spend / findings / resume / cancel / budget`.

### U012 — Telegram does not call setMyCommands

- **Severity**: high
- **Tier**: 2
- **Area**: channels / telegram
- **Description**: Telegram supports a bot-command menu via the `setMyCommands` API. factory5's Telegram plugin doesn't call it. The Telegram `/` autocomplete shows nothing for the bot.
- **Hypothesis**: On `start()`, call `setMyCommands` with the same command list as Discord. Add a parser branch for `/cmd args` (in addition to the existing `/build` parser).
- **Resolution**: Tier 2.

### U013 — No inline-keyboard / button affordances for pending-question UX

- **Severity**: medium
- **Tier**: 2
- **Area**: channels / discord / telegram
- **Description**: Pending-question round-trip is plain text on both Discord and Telegram. Discord supports buttons; Telegram supports inline keyboards. _"Answer / Skip / Escalate"_ buttons would be a meaningful UX upgrade.
- **Resolution**: Tier 2 — add buttons on the pending-question outbound messages.

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

### U022 — `el()` helper does not escape `setAttribute` arguments

- **Severity**: low
- **Tier**: 3 (folded into the component refactor)
- **Area**: web
- **Description**: `apps/factory-web/src/lib/api.ts:158` — `e.setAttribute(k, v)` is called with raw values from object spreads. Text content is safe (uses `createTextNode`), but attributes are not escaped. Today the only attribute values come from server-trusted strings, so practical risk is low. Still: not a robust pattern.
- **Resolution**: Tier 3 — `el()` is retired in favor of components; risk goes away.

### U023 — Brain triage routes channel chat to `intent=chat` rather than the eight-intent vocabulary

- **Severity**: high
- **Tier**: 2
- **Area**: brain / channels
- **Description**: The brain understands `build / fix / review / investigate / chat / status / resume / cancel`. Today, channel-originated chat (Discord thread reply, Telegram DM) becomes `intent=chat` regardless of content. A user asking _"what's the budget?"_ in Telegram gets a chat-intent LLM round-trip rather than a structured status response.
- **Hypothesis**: Update the triage prompt to classify across all 8 intents; channel handlers re-route the directive when the intent isn't chat (e.g. classified `intent=status` → status handler answers without LLM).
- **Resolution**: Tier 2.

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
