# Phase Plan

Derived from [`../SPEC.md`](../SPEC.md). Per-phase implementation detail lives in [`UPGRADE/plans/tier-N-*.md`](../../UPGRADE/plans) — Control phases iterate over those plans. The plans are richer; this file is the high-level summary + dependency graph.

## Phase ordering

| #   | Name           | Depends on                                  | Estimated sessions | Outcome                                                                                                                              |
| --- | -------------- | ------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | doc-sweep      | —                                           | ~1                 | All package READMEs current; `docs/ONBOARDING.md` covers web UI + chat; new `docs/WORKFLOWS.md`                                      |
| 2   | channel-parity | phase 1                                     | ~2                 | Discord slash commands + Telegram `setMyCommands` + button UX for pending-questions + `factory cancel` (real worker kill) + 8-intent triage |
| 3   | web-ui         | phase 2 (cancel plumbing reused)            | ~2-3               | Live directive updates via SSE, Astro component library, web chat, web cancel, web new-project, spend charts, mobile responsive    |
| 4   | cli-completion | phase 2 (cancel shell)                      | ~1                 | `factory cancel/budget/project/ask` + tab completion + `--help` examples on every command                                            |

Phases 3 and 4 share no critical code — order is operator preference once Phase 2 closes.

## Per-phase summaries

### Phase 1 — doc-sweep

**Goal:** Bring user-facing docs into line with what's actually shipped, and create the `docs/WORKFLOWS.md` that's missing from the doc graph.

**Key steps:** Fix `packages/cli/README.md` (drop Phase column, add `spend` / `findings` / `questions cleanup` rows, re-evaluate stub/planned markers); fix `packages/channels/README.md` (Telegram + web no longer "future"; add Telegram plugin and Web channel sections); fix `apps/factory-web/README.md` (drop phase-number references, add page index); add §"Web dashboard" + §"Chat — CLI / Discord / Telegram" to `docs/ONBOARDING.md`; write `docs/WORKFLOWS.md` (four canonical loops + decision matrix + CLAUDE.md authoring guide); single-pass audit of `docs/SKILLS.md` + `docs/AGENTS.md` against current code.

Full plan: [`../../UPGRADE/plans/tier-1-doc-sweep.md`](../../UPGRADE/plans/tier-1-doc-sweep.md). Issues addressed: U001, U002, U003, U014, U015, U016, U017.

**Done criteria highlights:** all four `pnpm` gates clean; cross-references between docs consistent; the new `docs/WORKFLOWS.md` referenced from at least three other docs.

### Phase 2 — channel-parity

**Goal:** Discord and Telegram match the brain's full eight-intent vocabulary (today: only `intent=build` and `intent=chat`).

**Key steps:** Wire Discord slash commands (`/factory status / spend / findings / resume / cancel / budget`); wire Telegram `setMyCommands` + matching parser; build transport-agnostic `command-handlers.ts` (shared between Discord embed / Telegram text formatters); add pending-question button affordances on both surfaces (Discord buttons via `ActionRowBuilder`; Telegram inline keyboards via `reply_markup`); ship `factory cancel <directive-id>` with real worker kill (brain hook + IPC route + CLI command); update triage to classify chat across all 8 intents and have channel handlers re-route reads (`status`/`spend`/`findings`) to shared handlers.

Full plan: [`../../UPGRADE/plans/tier-2-channel-parity.md`](../../UPGRADE/plans/tier-2-channel-parity.md). Issues addressed: U004, U011, U012, U013, U023 (and partially U005).

**Done criteria highlights:** `/factory <cmd>` autocompletes in Discord; Telegram `/` menu lists factory commands; `factory cancel` actually kills running workers within 10s (verified by process inspection); representative chat-classification test set has ≥ 25% non-`intent=chat` outcomes.

### Phase 3 — web-ui

**Goal:** Web UI uses real Astro components, has live updates via SSE, has a chat surface, and is mobile-responsive. Vanilla DOM-in-Astro becomes proper Astro + (optional) Solid/Preact islands.

**Key steps:** SSE on `/api/v1/directives/:id/stream` (events: `task.*`, `finding.created`, `spend.updated`, `log.line`, `directive.completed`); wire `directives/detail.astro` to the SSE stream; build Astro component library (`<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<PageShell>`); convert all 9 pages to use components; retire `el()` from `lib/api.ts`; add `/app/chat`, `/app/projects/new`, cancel/pause buttons on directive detail; spend page charts (sparklines + 30-day stacked bar); mobile-responsive nav (hamburger drawer at narrow widths); explicit logout + connection-status indicator.

Full plan: [`../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md`](../../UPGRADE/plans/tier-3-web-ui-live-and-complete.md). Issues addressed: U006, U007, U008, U009, U010, U022.

**Done criteria highlights:** kick off a build → tasks/findings/spend update live without refresh; web chat works end-to-end against a real factoryd; mobile nav functional at 375px; all four `pnpm` gates clean; `apps/factory-web` builds clean.

### Phase 4 — cli-completion

**Goal:** Every operator action available from web UI or channels is also available from the CLI. Plus tab completion and rich `--help` examples.

**Key steps:** Verify Phase 2's `factory cancel` shell; ship `factory budget set <project> --max-usd <n> [--max-steps <n>]`; ship `factory project list / show <name> / delete <name>`; ship `factory ask "<question>"` (single-shot chat); generate tab completion for bash/zsh/pwsh + `factory completion <shell>` install command; add `addHelpText('after', '...')` worked-example helpers on every command; refresh `packages/cli/README.md` once more for the new commands.

Full plan: [`../../UPGRADE/plans/tier-4-cli-completion.md`](../../UPGRADE/plans/tier-4-cli-completion.md). Issues addressed: U018, U019, U020, U021.

**Done criteria highlights:** all new commands have unit tests; tab completion produces valid bash/zsh/pwsh completion scripts; every `factory <cmd> --help` shows at least one worked example; all four `pnpm` gates clean.

## Guidance

- Each phase is sized for 1-3 operator working hours where possible. Phase 3 may split into 3a/3b/3c per the plan if the session count exceeds 3.
- Phases close with verifiable end-to-end outcomes (live build smoke for Phase 3; Discord live test for Phase 2). Internal-refactor-only phases aren't allowed.
- Every phase has a rollback plan documented in its `README.md` (default: `git reset --hard phase-<N-1>-<prev-name>-closed`).
- After Phase 2 closes, Phases 3 and 4 are independent — pick either based on operator preference.
- New issues discovered during a phase append to [`../../UPGRADE/ISSUES.md`](../../UPGRADE/ISSUES.md). Resolved issues move to the bottom-of-file "Resolved" section with a date.
