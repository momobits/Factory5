# Roadmap — factory5 first-class upgrade

Seven tiers, shippable independently. Tier order is dependency-aware: docs first because the rest reference them; channels before web UI because channel parity is the bigger felt gap; web UI rebuild is the heaviest tier; CLI completion is small. Tiers 5–7 were added post-arc as audit-driven follow-ups: Tier 5 brought the agent prompts up to factory5-native parity; Tier 6 closed the loop on the skills those prompts cite plus the runtime contract the fixer prompt documents; Tier 7 ships the operator-side parallel to Tier 6's agent-side parser (the `factory findings mark <id> <status>` CLI verb).

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

Ship the operator-side parallel to Tier 6's agent-side `RESOLUTION` parser. `factory findings mark <id> <status>` flips a finding's status (and optionally records a resolution note) via the same `updateFindingStatus` API the parser dispatches. Composition over existing surface — handler wraps the API, disambiguation copies `factory findings show`, tests mirror the existing findings test shape. Estimated **1 session, ~1 substantive commit**.

- [ ] Open U028 (`factory findings mark <id> <status>` CLI verb missing)
- [ ] Implement `runFindingsMark(db, rawId, rawStatus, opts)` in `packages/cli/src/commands/findings.ts` — wraps `updateFindingStatus`; bare-id disambiguation copies `runFindingsShow`; `--note <prose>` flows to `resolution`
- [ ] Wire `group.command('mark <id> <status>')` with `addHelpText('after', ...)` worked examples
- [ ] Unit tests in `findings.test.ts` (happy path / invalid status / ambiguous bare-id / not-found / `<project>/<id>` form / with `--note` / idempotent re-flip)
- [ ] Update `packages/cli/src/commands/completion.ts` `NESTED_SUBCOMMANDS` (add `mark` to the `findings` row) + `packages/cli/README.md` findings table
- [ ] Sweep `prompts/agents/fixer.md` for any "no operator CLI" phrasing left over from pre-7.2 reality

Plan: [`plans/tier-7-findings-mark.md`](plans/tier-7-findings-mark.md)

## Out of scope (now)

Items the audit raised that are deferred:

- **Bash sandboxing** — defer-on-incident; ADR 0028 §4 still applies; no demand signal yet.
- **Network egress scoping** — long-tail concern; wait for an egress-policy demand signal.
- **Multi-user UI auth** — single-operator design is OK for now.
- **Multi-tenant SaaS daemon** — out of charter.
- **VS Code extension** — out of charter.
- **Hosted "factory cloud"** — out of charter.
- **U005 chat 120 s timeout re-tier** — Tier 8 candidate; carry-forward from Phase 2's Tier-2-or-4 designation.
- **`factory skills list / show <name>` CLI commands** — skill discovery surface; Tier 8 candidate.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep absorbing filter-form Apply / "Clear all defaults" + inline-style audit pass; self-contained ~1 commit.
- **ADR amendments** — 0027 §1 missing route pin (POST `/api/v1/projects`), 0002 footnote stale post-Tier-5; doc-debt only.

These can be promoted to Tier 8+ if/when the demand signal arrives.

## Dependencies between tiers

| Item                                                   | Depends on                                                              |
| ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Tier 2 channel parity (status/spend/findings handlers) | Tier 1 docs (so the in-channel responses can link to docs/WORKFLOWS.md) |
| Tier 3 cancel button                                   | Tier 2 `factory cancel` shared code path                                |
| Tier 3 SSE stream                                      | Independent (can ship before Tier 2)                                    |
| Tier 4 CLI cancel                                      | Tier 2 brain hook (worker-kill plumbing)                                |
| Tier 4 CLI budget                                      | Independent (already wired on web side)                                 |

So Tier 1 → Tier 2 → Tier 3 + Tier 4 in parallel works. Tier 3 and Tier 4 share no critical code, so a session can pick either.
