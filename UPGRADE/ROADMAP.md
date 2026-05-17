# Roadmap — factory5 first-class upgrade

Thirteen tiers, shippable independently. Tier order is dependency-aware: docs first because the rest reference them; channels before web UI because channel parity is the bigger felt gap; web UI rebuild is the heaviest tier; CLI completion is small. Tiers 5–7 were added post-arc as audit-driven follow-ups: Tier 5 brought the agent prompts up to factory5-native parity; Tier 6 closed the loop on the skills those prompts cite plus the runtime contract the fixer prompt documents; Tier 7 shipped the operator-side parallel to Tier 6's agent-side parser (the `factory findings mark <id> <status>` CLI verb). Tier 8 reopens the arc post-Phase-7-close with the highest-leverage carry-forward — LLM auto-answer for `ask_user` pending-questions past their deadline, so autonomous runs unblock when the human is absent. Tier 9 reopens the arc again for the first frontend aesthetic overhaul in the project — porting the "Editorial Control Room" aesthetic from the sibling conductor project to `apps/factory-web` as a single-session, dual-theme redesign (informal cadence — no per-step commits, no ADR). Tier 13 reopens the arc once more to close the operator-felt loop Tier 12 structurally built but couldn't demonstrate end-to-end — the propagation gap surfaced by Phase 12's deferred smoke (operator-set `maxTurns*` is silently shadowed by planner-emit), plus polish (Windows daemon-stop pidfile cleanup) and two cheap Phase 12 carry-forwards (per-project default overrides extending to all axes; per-task USD cap).

## Status legend

- `[ ]` not started
- `[~]` in progress
- `[x]` complete

## Tier 1 — Doc + UX cleanup

Bringing the user-facing docs into line with reality. Estimated **1 session**.

- [x] Fix `packages/cli/README.md` — drop "Phase" column, add `spend` / `findings` / `questions cleanup` rows, re-evaluate stub/planned markers
- [x] Fix `packages/channels/README.md` — Telegram + web no longer "future"; add Telegram and Web sections
- [x] Fix `apps/factory-web/README.md` — remove phase-number references, add page index
- [x] Add §"Web dashboard" to `docs/ONBOARDING.md`
- [x] Add §"Chat — CLI / Discord / Telegram" to `docs/ONBOARDING.md`
- [x] Write `docs/WORKFLOWS.md` — four canonical loops + decision matrix + CLAUDE.md authoring guide
- [x] Reference `WORKFLOWS.md` from `README.md`, `CLAUDE.md`, `docs/ARCHITECTURE.md`, `docs/ONBOARDING.md`
- [x] Single-pass audit of `docs/SKILLS.md` + `docs/AGENTS.md` against current code

Plan: [`plans/tier-1-doc-sweep.md`](plans/tier-1-doc-sweep.md)

## Tier 2 — Channel parity

Discord/Telegram only emit `intent=build` and `intent=chat` today. Bring them up to the brain's full eight-intent vocabulary. Estimated **2 sessions**.

- [x] Discord slash commands — `/factory status / spend / findings / resume / cancel / budget / build` (registers `factory` slash, wires `interactionCreate` dispatch)
- [x] Discord embeds for status / findings / spend responses
- [x] Telegram bot commands — `setMyCommands` + matching parser (shared `command-handlers.ts` with Discord)
- [x] Telegram inline keyboard buttons on pending-question messages (Answer / Skip / Escalate)
- [x] Discord buttons on pending-question messages (same shape)
- [x] Add `factory cancel <directive-id>` — CLI command + IPC route + brain hook (kills worker, not just flips status)
- [x] Update triage prompt to classify chat across all 8 intents
- [x] Channel handlers re-route classified intents (e.g. `intent=status` from Telegram chat answers with status, not LLM chat)

Plan: [`plans/tier-2-channel-parity.md`](plans/tier-2-channel-parity.md)

## Tier 3 — Web UI live and complete

Vanilla DOM-in-Astro → real Astro components + live updates + complete operating surface. Estimated **2-3 sessions**.

- [x] SSE on `/api/v1/directives/:id/stream` — events: `task.*`, `finding.created`, `spend.updated`, `log.line`
- [x] Wire `directives/detail.astro` to the SSE stream (live tasks, findings, spend, log tail)
- [x] Astro component library — `<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<PageShell>`
- [x] Convert all 10 pages to use components; retire `el()` (and `loadInto()`) from `lib/api.ts`
- [x] Add `/app/chat` page — mirror of `factory chat` in browser
- [x] Add cancel button on directive detail (pause deferred — operator workflow signal not present yet; see phase-3-web-ui/steps.md follow-up bullet)
- [x] Add `/app/projects/new` — mirror of `factory init` for a single project
- [x] Spend page charts — sparkline per project + 30-day daily stacked bar
- [x] Mobile-responsive nav (hamburger drawer at narrow widths)
- [x] Explicit logout + connection-status indicator in header

Plan: [`plans/tier-3-web-ui-live-and-complete.md`](plans/tier-3-web-ui-live-and-complete.md)

## Tier 4 — CLI completion

Polish. Estimated **1 session**.

- [x] `factory cancel <directive-id>` (shared with Tier 2; Phase 4.1 live-smoke verified the 4-code exit surface)
- [x] `factory budget set <project> --max-usd <n> [--max-steps <n>]`
- [x] `factory project list / show <name> / delete <name>`
- [x] `factory ask "<question>"` — single-shot chat
- [x] Tab completion for bash/zsh/pwsh
- [x] Rich `--help` examples on every command (`addHelpText('after', ...)`)

Plan: [`plans/tier-4-cli-completion.md`](plans/tier-4-cli-completion.md)

## Tier 5 — Agent prompts + targeted doc sweep

Build new (not ported) factory5-native bodies for the 3 pure stub agent prompts + flesh out the 1 hybrid; drop the stale stub-tracking column from `prompts/agents/README.md`; correct stale `docs/ONBOARDING.md` §5.4 claims surfaced post-Tier-3; resolve the `factory logs` stub. Estimated **1 session**.

- [x] `prompts/agents/README.md` — drop stale stub-tracking column (replace with `File | Role | Purpose`)
- [x] `docs/ONBOARDING.md` §5.4 — drop read-once + project-creation-out-of-scope claims (both shipped past in Tier 3)
- [x] `prompts/agents/reviewer.md` — write factory5-native body (advisory-vs-blocking policy pinned, FINDING marker contract verified)
- [x] `prompts/agents/fixer.md` — write factory5-native body (verify `markFinding` parser branch first; may re-scope to `feat`)
- [x] `prompts/agents/investigator.md` — write factory5-native body (read-only constraint with concrete examples; structural conventions, not parser contract)
- [x] `prompts/agents/builder.md` — flesh out factory5-native body (preserve Python venv discipline byte-for-byte)
- [x] `factory logs` — implement minimal _or_ retire (operator's call before 5.8 starts)

Plan: [`plans/tier-5-agent-prompts.md`](plans/tier-5-agent-prompts.md)

## Tier 6 — Skills review + rewrites + fixer parser path

Audit all 12 skills in `skills/` against factory5 reality (current ADRs, current code paths, current marker grammars). Rewrite skills where factory2-era assumptions contradict shipped state; drop the "ported from factory2" provenance language once factory5-native. Plus: wire a brain-side parser for the fixer agent's `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX): ...` markers so the runtime contract Tier 5 documented actually fires `updateFindingStatus`. Estimated **1–2 sessions** (single session if 6.2's audit finds 0–2 rewrites needed and 6.3 has a clean attach point).

- [x] Open U026 (skills audit) + U027 (fixer parser path)
- [x] `skills/` audit pass — per-skill verdict (4 clean / 2 hot-fix / 6 rewrite); commit body documented the 12-line classification at `97c8e45`
- [x] Wire `RESOLUTION` marker parser in `packages/worker/src/parse-resolutions.ts` → calls `updateFindingStatus(...)`; 9 unit tests; `prompts/agents/fixer.md` updated to drop "no parser today" caveat at `65729cf` (closes U027)
- [x] Per-skill rewrites (6 alphabetical: code-review / dependency-install / error-recovery / progress-tracking / scaffolding / work-verification at `1ea2d82` / `1e5a67e` / `d7a9b7e` / `7b409ac` / `f1e1075` / `a4b51e6`)
- [x] `docs/SKILLS.md` — dropped `Initial skills ported from factory2/skills/` provenance line; applied 6.2-flagged hot-fixes (`brainstorming`, `integration-testing`) at `e942ec7` (closes U026)

Plan: [`plans/tier-6-skills-rewrites.md`](plans/tier-6-skills-rewrites.md)

## Tier 7 — `factory findings mark <id> <status>` CLI command

Shipped the operator-side parallel to Tier 6's agent-side `RESOLUTION` parser. `factory findings mark <id> <status>` flips a finding's status (and optionally records a resolution note) via the same `updateFindingStatus` API the parser dispatches. Composition over existing surface — handler wraps the API, disambiguation copies `factory findings show`, tests mirror the existing findings test shape. Closed in **1 session** at `phase-7-findings-mark-closed` 2026-05-08.

- [x] Open U028 (`factory findings mark <id> <status>` CLI verb missing) at `b1dd5d6`
- [x] Implement `runFindingsMark(db, rawId, rawStatus, opts)` in `packages/cli/src/commands/findings.ts` — wraps `updateFindingStatus`; bare-id disambiguation copies `runFindingsShow`; `--note <prose>` flows to `resolution`; closes U028 at `0d27925`
- [x] Wire `group.command('mark <id> <status>')` with `addHelpText('after', ...)` worked examples at `0d27925`
- [x] Unit tests in `findings.test.ts` (8: bare-id happy path / `<project>/<id>` form when bare would be ambiguous / ambiguous bare-id rejection / invalid status / not-found in both forms / `--note` persistence / case-insensitive input / idempotent re-flip preserves resolvedAt) at `0d27925`
- [x] Update `packages/cli/src/commands/completion.ts` `NESTED_SUBCOMMANDS` (add `mark` to the `findings` row) + `packages/cli/README.md` findings table at `0d27925`
- [x] Sweep `prompts/agents/fixer.md` for any "no operator CLI" phrasing left over from pre-7.2 reality — came up empty; Tier 6's 6.3 had already cleared those at `0d27925`

Plan: [`plans/tier-7-findings-mark.md`](plans/tier-7-findings-mark.md)

## Tier 8 — `ask_user` deadline + LLM auto-answer

When an `ask_user` pending-question goes unanswered past its deadline and the parent directive is still active, factory makes an LLM call with the question + surrounding context, writes the answer back, marks it `answered_by = 'agent'`, and lets the directive proceed. Today an unanswered question blocks indefinitely (until the orphan sweep runs after the directive itself terminates) — autonomous runs stall waiting on a human who isn't there. Estimated **2 sessions**.

- [x] Open U029 (unanswered `ask_user` blocks directive; no auto-answer fallback)
- [x] Migration 009 — `pending_questions.answered_by` column (`'user' | 'agent' | 'agent-failed' | 'orphan-sweep'`) + backfill orphan-sweep + user rows
- [x] ADR 0030 — pending-question auto-answer contract (enum semantics, daemon-wide config home, LLM dispatcher failure path, no-override-after-auto-answer rule)
- [x] `loadConfig()` / `writeConfig()` reader+writer for `<dataDir>/config.json` (`askUserDeadlineMs` default 5 min; configurable without code changes; schema/types in `@factory5/core`, I/O in `@factory5/state`)
- [x] Brain stamps `deadline_at` from config on every new `ask_user`
- [x] Brain tick-loop sweep + LLM auto-answer dispatcher (`packages/brain/src/auto-answer.ts`); retry once → write `'agent-failed'` synthetic on second failure; sentinel race-mitigation claim; throttled to 5s in `runServe`
- [x] Surface `answered_by` in web `/app/questions/index` (column) and `/app/questions/detail` (meta row); CLI list/show deferred (subcommands don't exist today)

Plan: [`plans/tier-8-question-auto-answer.md`](plans/tier-8-question-auto-answer.md)

## Tier 9 — Control Room redesign (factory-web editorial port)

Port the "Editorial Control Room" aesthetic from the sibling conductor project (`G:/Projects/Small-Projects/Harness/conductor`, Phase 19) to `apps/factory-web`. Fraunces display serif + Bricolage Grotesque body + JetBrains Mono data; vermillion (`#ff4d1c`) signal accent; hairline rules; paper-grain backdrop; letterpress card tiles; numbered nav; oversized italic page titles; monospaced status pip with pulse. Dual-theme via `prefers-color-scheme` — warm parchment + ink in light, ink-black + paper in dark — with status semantics (green / amber / red) held theme-independent. First tier in the arc that ships visual-design work without an underlying contract change. Estimated **1 session** (delivered in 1 — informal cadence, no per-step commits).

- [x] Rewrite `apps/factory-web/src/layouts/Dashboard.astro` inline `<style is:global>` block — new CSS custom-property design tokens flipped by `prefers-color-scheme`; editorial masthead (brand mark + brand name + italic strapline + edition stamp + double rule); numbered nav (`01 OVERVIEW` … `08 FINDINGS`); monospaced status pip with pulse animation; paper-grain SVG noise + radial-gradient atmosphere; `.page-title` block so all 12 pages get the new italic Fraunces page heading without page-side changes
- [x] Re-wire 8 component primitives (Card, Table, Alert, Field, Form, Submit, EmptyState, PageShell) to the new tokens — most scoped styles dropped, visual treatment lives in Dashboard's global stylesheet so pages that hand-roll `<div class="card">` / `<form class="form">` markup pick up the look automatically
- [x] Dual-theme tokens — light defaults at `:root`, dark override block inside `@media (prefers-color-scheme: dark)`; vermillion + status semantics held identical across themes
- [x] All four `pnpm` gates green: build / test / lint / format:check
- [x] Absorbs the Phase 8 carry-forward "PageShell + Dashboard `<style is:global>` migration" — global stylesheet now carries the look pages have always referenced

Plan: [`plans/tier-9-control-room-redesign.md`](plans/tier-9-control-room-redesign.md)

## Tier 10 — Resume button + activity feed on directive detail

Close two operator-feels-blind gaps surfaced by an `automl` build failure 2026-05-16. (1) No UI surface for `factory resume` — CLI command exists at `packages/cli/src/commands/resume.ts` but the daemon has no HTTP mirror; operator viewing a failed directive from a phone has no recovery action. (2) Directive-detail activity panel is silent on `build` directives because the brain emits only one `log.line` SSE event today (`packages/brain/src/loop.ts:258`, chat reply only). The `automl` planner crashed on a Zod schema validation after a 10-minute Sonnet call; the operator saw the directive flip `running → failed` with no narrative of _what_ the brain was doing or _where_ it broke. SSE plumbing from Phase 3 (ADR 0029) is in place; only emission-side coverage is sparse. Estimated **2 sessions**.

- [x] Open U030 (no UI surface for resume; activity panel silent on build directives)
- [x] ADR 0031 — log-forwarder design: manual `emitLogLine` sites as first-ship; pino-transport-tap and hybrid listed as alternatives considered + Tier 11 candidates
- [x] Brain `emitLogLine` narrative sites in `architect.ts` / `planner.ts` / `pool.ts` / `loop.ts`; planner parse-fail and Zod-fail surface first 500 chars of LLM output as `attrs.detail`
- [x] `POST /api/v1/directives/:id/resume` daemon route — mirrors `factory resume` CLI logic (parentDirectiveId + payload.resumeFrom chain); 404 missing prior; 409 prior non-terminal; 422 prior projectPath missing on disk
- [x] UI: Resume button on directive-detail when status terminal (`failed | blocked | complete`); per-row Resume link on Projects index when most-recent directive is terminal-non-complete
- [x] UI: activity panel level badges (info / warn / error using design tokens) + empty-state "Waiting for the brain to narrate…" hint
- [x] U030 closes when 10.5 lands

Plan: [`plans/tier-10-resume-and-activity-feed.md`](plans/tier-10-resume-and-activity-feed.md)

## Tier 11 — Per-directive log persistence

Close two operator-felt gaps from Tier 10's post-close smoke: (1) activity panel disappears on refresh because `log.line` events are SSE-only / ephemeral; (2) multi-tab consistency — tabs that subscribe after another tab miss historic events. Migration 010 adds `directive_log_lines` table; daemon `DirectiveStreamHub.emit` tees `log.line` events to DB before fanning out; new `GET /api/v1/directives/:id/logs` returns historic per-directive events; FE replays on connect and dedups against the live SSE stream via a join-cursor. Estimated **1 session**.

- [x] Open U031 (activity panel empty after reload; multi-tab event split)
- [x] Migration 010 — `directive_log_lines` table (directive_id / ts / level / component / msg / attrs_json + ts index); three pre-existing migration shape tests bump to `[1..10]`
- [x] State queries — `appendLogLine`, `listForDirective`; unit tests
- [x] Daemon hub tees `log.line` to DB on emit; integration test asserts read-back
- [x] `GET /api/v1/directives/:id/logs?since=<iso>&limit=<n>` daemon route; bearer-auth; 5 integration tests (3 from the plan + 404 + empty-list)
- [x] FE replay + dedup — fetch historic before attaching SSE; events with `ts <= joinCursor` are dropped (fixed cursor — see plan-deviation in steps.md)
- [x] U031 closes

Plan: [`plans/tier-11-directive-log-persistence.md`](plans/tier-11-directive-log-persistence.md)

## Tier 12 — Budget UX: surface all knobs, escalate instead of hard-fail

Operator complaint 2026-05-16: _"why are we failing instead of asking the user if we should continue over the budget?"_ The codebase has 15 hardcoded budgets and timeouts; operators control 2 (maxUsd, maxSteps); per-task `maxTurns` failures are silent. Six budgets identified as operator-facing in the Tier 12 audit. Surface them at build time via Web UI accordion + CLI flags with defaults + explainers; persist on directive payload; inherit on resume; escalate on `error_max_turns` via typed askUser instead of hard-fail; ADR 0032 pins the paradigm. Estimated **2 sessions**.

- [x] Open U032 (operator-invisible turn budgets; hard-fail without retry-question escalation)
- [x] ADR 0032 — Budget UX paradigm (operator-facing vs internal-pacing budgets, default-publication contract, escalation rule, persistence contract)
- [x] `BUDGET_DEFAULTS` constant + Zod schema in `@factory5/core` — single source of truth for defaults + explainers
- [x] Web UI Build form: "Advanced budgets" accordion (collapsed by default) with six fields + defaults + explainers
- [x] CLI flags on `factory build` and `factory resume`: `--max-usd`, `--max-steps`, `--ask-user-deadline-ms`, `--max-turns-scaffolder`, `--max-turns-builder`, `--max-turns-fixer`; `--help` post-text quotes explainers
- [x] Directive `payload.budgets` field; Tier 10 resume route inherits full budget set
- [x] Brain escalation in `pool.ts` — detect `error_max_turns` subtype, raise typed askUser with bump suggestion; relaunch task on accept; abort path mirrors current failed-task behaviour
- [x] Tier 8 auto-answer adapter — bump-by-one-bucket on first budget failure, abort on second
- [x] U032 closes

Plan: [`plans/tier-12-budget-ux.md`](plans/tier-12-budget-ux.md)

## Tier 13 — Budget followups: propagation fix + per-project defaults + per-task USD cap

Phase 12 closed structurally green but the deferred live browser smoke failed the operator-felt gate: a build with `maxTurnsScaffolder=10` in the UI persisted `payload.budgets.maxTurnsScaffolder=10` daemon-side, planner emitted `maxTurns: 40`, scaffolder ran 40 turns with no `[BUDGET]` askUser. Investigation traced to `resolveTaskMaxTurns` preferring `task.maxTurns` (planner-emit, always set per the planner prompt's 10-160 range) over `directive.payload.budgets[axis]` (operator). Tier 13 closes that loop, polishes the Windows daemon-stop sloppy-shutdown bug (U034) discovered at the Phase 12 close arc, extends per-project default overrides to cover all axes, and ships the per-task USD cap Phase 12 carry-forwarded. Mid-task escalation + budget audit dashboard remain deferred to Tier 14+. Estimated **2-3 sessions**.

- [x] Open U033 (operator-set `maxTurns*` silently shadowed by planner-emit)
- [x] Open U034 (Windows daemon-stop leaves stale pidfile)
- [ ] Fix U033: `resolveTaskMaxTurns` returns `min(planner_emit, operator_ceiling)`; docstring rewrites; ADR 0032 amendment OR new ADR 0033
- [ ] Fix U034: post-`waitPidGone()` belt-and-suspenders pidfile cleanup with same-PID race-restart predicate; cross-platform integration test
- [ ] Per-project budget defaults extension — `<project>/.factory/project.json` `metadata.budgetDefaults` widens from `{maxUsd, maxSteps}` to all axes; three-tier resolution preserved
- [ ] Per-task USD cap (`maxUsdPerTask`) — new seventh axis in `BUDGET_DEFAULTS`; pool pre-launch check; planner emits per-task `estimatedUsd`; auto-answer recognition generalises across axes
- [ ] Browser smoke (Playwright MCP, `smoke-demo`, $1.50 cap) — operator-set `maxTurnsScaffolder=10` floors the planner emit → `[BUDGET]` askUser fires → accept → retry → success
- [ ] U033 + U034 close

Plan: [`plans/tier-13-budget-followups.md`](plans/tier-13-budget-followups.md)

## Out of scope (now)

Items the audit raised that are deferred:

- **Bash sandboxing** — defer-on-incident; ADR 0028 §4 still applies; no demand signal yet.
- **Network egress scoping** — long-tail concern; wait for an egress-policy demand signal.
- **Multi-user UI auth** — single-operator design is OK for now.
- **Multi-tenant SaaS daemon** — out of charter.
- **VS Code extension** — out of charter.
- **Hosted "factory cloud"** — out of charter.
- **U005 chat REPL cancel UX path (a+)** — twice-deferred carry-forward; Tier 9 candidate. Path (a+): bump REPL daemon-reply timeout to 10 min + print directive id + heartbeat + SIGINT handler + clean exit prompt.
- **Per-project deadline override** — CLAUDE.md frontmatter or `<project>/.factory/project.json` `metadata.askUserDeadlineMs`. Non-breaking to add atop Tier 8's daemon-wide config; deferred until demand signal.
- **`factory config get / set <key>` CLI** — operator surface for editing `<dataDir>/config.json` without hand-editing the JSON. Add when other config keys need editing too.
- **`factory skills list / show <name>` CLI commands** — skill discovery surface; carry-forward; no demand signal.
- **Inline-style audit on the 12 pages** — Tier 9's editorial port absorbed the PageShell + Dashboard `<style is:global>` migration de facto, but a handful of cosmetic-only `style=` attributes remain on pages (e.g. `index.astro:15` `style="margin-top: 1.5rem;"`). Self-contained ~30-min sweep when motivated.
- **ADR amendments** — 0027 §1 missing route pin (POST `/api/v1/projects`), 0002 footnote stale post-Tier-5; doc-debt only.

These can be promoted to Tier 9+ if/when the demand signal arrives.

## Dependencies between tiers

| Item                                                   | Depends on                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Tier 2 channel parity (status/spend/findings handlers) | Tier 1 docs (so the in-channel responses can link to docs/WORKFLOWS.md) |
| Tier 3 cancel button                                   | Tier 2 `factory cancel` shared code path                                |
| Tier 3 SSE stream                                      | Independent (can ship before Tier 2)                                    |
| Tier 4 CLI cancel                                      | Tier 2 brain hook (worker-kill plumbing)                                |
| Tier 4 CLI budget                                      | Independent (already wired on web side)                                 |
| Tier 8 deadline sweep                                  | Independent of Tiers 2–7; extends ADR 0024's `ask_user` flow            |

So Tier 1 → Tier 2 → Tier 3 + Tier 4 in parallel works. Tier 3 and Tier 4 share no critical code, so a session can pick either. Tier 8 has no code dependency on prior tiers — it extends the `ask_user` flow that has been live since the original architecture.
