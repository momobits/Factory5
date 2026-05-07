# Phase Plan

Derived from [`../SPEC.md`](../SPEC.md). Per-phase implementation detail lives in [`UPGRADE/plans/tier-N-*.md`](../../UPGRADE/plans) — Control phases iterate over those plans. The plans are richer; this file is the high-level summary + dependency graph.

## Phase ordering

| #   | Name           | Depends on                       | Estimated sessions | Outcome                                                                                                                                               |
| --- | -------------- | -------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | doc-sweep      | —                                | ~1                 | All package READMEs current; `docs/ONBOARDING.md` covers web UI + chat; new `docs/WORKFLOWS.md`                                                       |
| 2   | channel-parity | phase 1                          | ~2                 | Discord slash commands + Telegram `setMyCommands` + button UX for pending-questions + `factory cancel` (real worker kill) + 8-intent triage           |
| 3   | web-ui         | phase 2 (cancel plumbing reused) | ~2-3               | Live directive updates via SSE, Astro component library, web chat, web cancel, web new-project, spend charts, mobile responsive                      |
| 4   | cli-completion | phase 2 (cancel shell)           | ~1                 | `factory cancel/budget/project/ask` + tab completion + `--help` examples on every command                                                             |
| 5   | agent-prompts  | —                                | ~1                 | All active agent prompts substantive + factory5-native; stale doc claims (prompts README + ONBOARDING §5.4) aligned with Tier-1–4 reality; `factory logs` either implemented minimally or retired |
| 6   | skills-rewrites | phase 5 (closes the agent-prompts arc) | ~1-2               | All 12 skills in `skills/` audited against factory5 reality; rewrites where needed; "ported from factory2" provenance dropped from `docs/SKILLS.md`. Plus: brain-side parser for fixer's `RESOLUTION` markers so `updateFindingStatus` fires on agent declaration |

Phases 3 and 4 share no critical code — order is operator preference once Phase 2 closes. Phase 5 has no code dependencies (pure docs + prompts + an optional small CLI command); shippable after Phase 4 closes (the natural sequence) or independently. Phase 6 is the natural continuation of Phase 5 — closes the agent-prompts arc by auditing the skills the prompts cite + wiring the fixer marker grammar Phase 5 documented.

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

### Phase 5 — agent-prompts

**Goal:** Every active agent prompt in `prompts/agents/` is substantive and factory5-native (built for current architecture, not ported wholesale from factory2). Stale doc claims that conflict with what shipped through Tiers 1–4 are corrected. The single CLI stub-by-design (`factory logs`) is either implemented minimally or retired.

**Key steps:** Open U024 (prompts README is stale) + U025 (ONBOARDING §5.4 read-once claim is stale post-Tier-3) + add Tier 5 to ROADMAP; drop the stale stub-tracking column from `prompts/agents/README.md` (replace with `File | Role | Purpose`); correct ONBOARDING §5.4's "read-once" + "no project creation in SPA" claims that Tier 3 shipped past; write `reviewer.md` / `fixer.md` / `investigator.md` from scratch (not ported — factory5-native against current ADRs and the existing FINDING marker contract); flesh out `builder.md` factory5-native TDD body while preserving the venv discipline section byte-for-byte (it prevents I007 host-pollution); decide and execute on `factory logs` (Path A implement-minimal vs Path B retire).

Full plan: [`../../UPGRADE/plans/tier-5-agent-prompts.md`](../../UPGRADE/plans/tier-5-agent-prompts.md). Issues addressed: U024, U025.

**Done criteria highlights:** all four `pnpm` gates clean; `prompts/agents/README.md` accurately reflects every prompt's role + purpose with no transient status field; the 4 deficient prompts (reviewer / fixer / investigator / builder) carry factory5-native bodies with no `Phase 1 stub` markers and no `factory2` references; `docs/ONBOARDING.md` §5.4 reflects post-Tier-3 SSE + project-creation reality; no half-stub `factory logs` row in CLI README.

### Phase 6 — skills-rewrites

**Goal:** Every skill in `skills/` is factory5-native — audited against current architecture (current ADRs, current code paths, current marker grammars), and either confirmed clean or rewritten. The "ported from factory2" provenance language in `docs/SKILLS.md` is gone. Plus: the fixer agent's `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): ...` marker grammar — documented prose-only in Tier 5 — gets a brain-side parser so the registry actually flips on agent declaration.

**Key steps:** Open U026 (skills audit) + U027 (fixer parser path); 12-skill audit pass with per-skill verdict (`clean` / `hot-fix` / `rewrite`); wire `RESOLUTION` marker parser in `packages/brain/src/` calling `updateFindingStatus(...)` (closes U027); per-skill rewrites for skills flagged `rewrite` in the audit; drop `Initial skills ported from factory2/skills/` line from `docs/SKILLS.md` + apply hot-fixes (closes U026).

Full plan: [`../../UPGRADE/plans/tier-6-skills-rewrites.md`](../../UPGRADE/plans/tier-6-skills-rewrites.md). Issues addressed: U026, U027.

**Done criteria highlights:** all four `pnpm` gates clean; no skill body in `skills/` references `factory2`; `docs/SKILLS.md` line 7 forward-looking; `prompts/agents/fixer.md` no longer carries "no parser today" caveat; new parser function with at least one unit test; manual or integration verification that a `RESOLUTION` marker in agent output flips a `findings.json` row.

## Guidance

- Each phase is sized for 1-3 operator working hours where possible. Phase 3 may split into 3a/3b/3c per the plan if the session count exceeds 3.
- Phases close with verifiable end-to-end outcomes (live build smoke for Phase 3; Discord live test for Phase 2). Internal-refactor-only phases aren't allowed. Phase 5 is the soft exception — prompt content is verified by the brain consuming it on the next directive run + by inspection (substantive content, correct frontmatter, references that resolve), rather than by a single smoke test.
- Every phase has a rollback plan documented in its `README.md` (default: `git reset --hard phase-<N-1>-<prev-name>-closed`).
- After Phase 2 closes, Phases 3 and 4 are independent — pick either based on operator preference. Phase 5 has no hard dependency on prior phases (only references their work in doc fixes).
- New issues discovered during a phase append to [`../../UPGRADE/ISSUES.md`](../../UPGRADE/ISSUES.md). Resolved issues move to the bottom-of-file "Resolved" section with a date.
