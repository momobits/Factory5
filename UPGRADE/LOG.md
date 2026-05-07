# Upgrade log

Session-by-session handoff log. Append a new section at the **top** at session end. Most recent entry is what a new session reads first.

Each entry should answer: what was done, what was decided, what's next.

---

## 2026-05-07 — Phase 5 (agent-prompts) closed; upgrade arc complete (again, post-Tier-5 audit pass)

`/phase-close` ran on the Phase 5 work. All nine sub-steps shipped (5.1 → 5.8 in this session, plus the 5.9 close). Tagged `phase-5-agent-prompts-closed` (annotated) at the close commit. **No Phase 6 scaffolded** — `phase-plan.md` defines no Phase 6 entry; the upgrade arc is complete (again) post Tier 5's audit-driven addendum. STATE.md transitions back to "all phases complete".

**Why a Tier 5 was needed at all:** post-Tier-4 audit (2026-05-07) surfaced three categories of staleness in the codebase:

1. **Three pure stub agent prompts ship to the model on every directive** — `prompts/agents/reviewer.md`, `fixer.md`, `investigator.md` were 10-line files with `> **Phase 1 stub. Body to be ported from factory2…**` markers. The brain dispatched the agent's role on a 10-line prompt; the deficient roles do real work in some directive shapes (multi-builder fix passes, novel-problem investigations).
2. **One hybrid lied about itself** — `builder.md` had substantive Python venv discipline (load-bearing for I007 host-pollution prevention) but still flagged itself as a "Phase 1 stub". A reader hit the marker and assumed the file was empty.
3. **Two stale doc claims compounded discoverability** — `prompts/agents/README.md` falsely flagged all 9 prompts as "stub" (5 are substantive); `docs/ONBOARDING.md` §5.4 claimed detail pages are read-once + projects can't be created from the SPA — both shipped past in Tier 3 (SSE on `/api/v1/directives/:id/stream`; `/app/projects/new` route).

Plus one carry-over: `factory logs` had shipped as a "stub that prints a hint" since Phase 1 of the original arc.

User directive at session start: **"build new for factory5, don't port from factory2."**

**What shipped in Phase 5** (cumulative across the single-session arc):

- **5.1** — Opened U024 (`prompts/agents/README.md` status table is stale) + U025 (`docs/ONBOARDING.md` §5.4 read-once + project-creation-out-of-scope claims are stale post-Tier-3) in `UPGRADE/ISSUES.md`. Both had Hypothesis lines pointing at the planned remediation. Commit: `chore(5.1): open U024 + U025` at `8fb3b29`.
- **5.2** — Dropped the stale Status column from `prompts/agents/README.md`; replaced with `File | Role | Purpose` (one-line role descriptions sourced verbatim from `docs/AGENTS.md` so the two docs can't drift). Dropped the "Phase 1 work" trailer. Folded legacy/ rows into a single explanatory paragraph below the table. Closes U024. Commit: `docs(5.2): prompts/agents/README.md — drop stale stub-tracking column` at `e08f062`.
- **5.3** — Re-titled `docs/ONBOARDING.md` §5.4 from "Today's limitations" to "Live updates + write-mode" (the section now describes capability rather than gaps). Confirmed SSE live updates with the 15s `:keepalive` heartbeat + connect-time backfill + polling fallback (cites ADR 0029). Confirmed full write-mode (build / projects/new / projects/detail budget edit / questions/detail answer / chat) with ADR 0027 reference. Added missing rows to §5.3's page tour table (`/app/chat/`, `/app/projects/new/`); tagged `directives/detail` as SSE-live. Three follow-up flags surfaced (§6.4 polling-fetch reference; §6.1 stale Tier-2-or-4 hint about U005; ADR 0027 §1 doesn't pin POST `/api/v1/projects`). Closes U025. Commit: `docs(5.3): docs/ONBOARDING.md §5.4 — drop read-once claim post-Tier-3` at `27dc6c7`.
- **5.4** — Wrote `prompts/agents/reviewer.md` from scratch (factory5-native, ~156 lines after prettier). Pre-write homework verified the runtime contract: reviewer findings flow as **blocking** by default per `packages/wiki/src/findings.ts:130`'s `resolveAdvisory` (auto-defaults `advisory: true` only for `source: 'verifier'`). Operational caveat captured: brain's `hadFailures` (`packages/brain/src/loop.ts:435-438`) is gated on assessor `gate.verify` + task exit codes, not finding count, so "blocking" is operator-visibility distinction rather than auto-stop. Adversarial framing + shadow-test affordance + anti-noise gate + severity-evidence-floor table all pinned. Runtime contract pins: marker grammar via `packages/worker/src/parse-findings.ts`; source-string auto-stamped at `run-worker.ts:203`. Tools envelope pinned (Read/Write/Glob/Grep — no Edit, no Bash). No ADR 0030 needed. Commit: `docs(5.4): prompts/agents/reviewer.md — write factory5-native body` at `21bf980`.
- **5.5** — Wrote `prompts/agents/fixer.md` from scratch (factory5-native, ~158 lines after prettier). Pre-write homework grep-verified that **no agent-output → `updateFindingStatus` parser path exists** anywhere in `packages/brain/src/` or `packages/worker/src/`. Wiki API exists at `findings.ts:196` (only invoked from tests); no CLI `factory findings mark` command. Branch 3 chosen (prose-only); commit type stayed `docs(5.5)`. `RESOLUTION <FID> (FIXED|VERIFIED|WONTFIX)` marker grammar pinned as future-parser lock-on shape (Tier 6 candidate). Finding-by-ID intake contract pinned (cites ADR 0021 cross-project addressing); file-ownership scope rule pinned (target glob is the boundary; `ask_user` required to widen). Commit: `docs(5.5): prompts/agents/fixer.md — write factory5-native body (branch 3, prose-only)` at `839c2c1`.
- **5.6** — Wrote `prompts/agents/investigator.md` from scratch (factory5-native, ~140 lines after prettier). Read-only constraint pinned with concrete OK / NOT-OK Bash example lists (the load-bearing sections of the prompt). HYPOTHESIS / EVIDENCE / RECOMMENDED NEXT framed as operator-readable conventions (not parsed); the brain has no parser today, but the marker grammar is what a future parser would lock onto. RECOMMENDED NEXT vocabulary pinned (`fixer <project>/<finding-id>` / `architect` / `none — false alarm` / `more investigation needed`). Tools envelope pinned (Read/Glob/Grep/Bash + ask_user; no Write/Edit). Commit: `docs(5.6): prompts/agents/investigator.md — write factory5-native body` at `ae47147`.
- **5.7** — Fleshed out `prompts/agents/builder.md` (factory5-native, ~185 lines after prettier; comparable to scaffolder 178 / planner 197). **CRITICAL preservation**: the existing Python venv discipline section (load-bearing for I007 host-pollution defence) preserved byte-for-byte, verified via `git diff | grep ^-` showing only 4 removed lines (3 from old frontmatter description + the stub marker). New TDD body added on top (six-step Red-Green-Refactor cycle with builder-specific framing); file ownership scope pinned (planner's `expectedOutputs.files[]` as boundary, `expectedOutputs.signals[]` as done-criterion); BUILD.md prohibition preserved verbatim; "Findings — you cite, you do not raise" rule explicit (builder has Write but shouldn't use it for finding emission). Commit: `docs(5.7): prompts/agents/builder.md — flesh out factory5-native body` at `005e75b`.
- **5.8** — Path B (retire) chosen for `factory logs` per plan default + auto-mode "make reasonable assumptions". Deleted `packages/cli/src/commands/stubs.ts` (single-purpose file containing only the logs stub). Removed `registerStubCommands` import + call from `packages/cli/src/cli.ts`. Dropped the row from `packages/cli/README.md` (the table now contains zero stub rows). Dropped `'logs'` from `packages/cli/src/commands/completion.ts`'s top-level command vocab. ADR 0002 footnote about `factory logs` (Consequences §) flagged but unedited (CLAUDE.md "do not edit accepted ADRs in `docs/decisions/` — supersede with a new one"; superseding for one footnote is over-engineering). All four `pnpm` gates green post-deletion (build / test 13 packages all passing / lint / format:check). The help-coverage test (`packages/cli/src/help-coverage.test.ts`) walks the Commander tree dynamically and shrunk by one leaf without changes. Commit: `chore(5.8): retire factory logs stub` at `59a684f`.
- **5.9** — `/phase-close` (this commit's structural close).

**ADRs decided in Phase 5:** none. Pre-write homework for 5.4 (reviewer findings policy) + 5.5 (fixer parser path) both confirmed unambiguous runtime contracts — no ADR 0030 was needed. Cumulative ADR count for the upgrade arc remains **three** (0027 / 0028 / 0029 — all decided in Phase 3).

**Issues closed in Phase 5:** U024 + U025 (both opened by 5.1, closed by 5.2 + 5.3 respectively). Sha-backfill for both resolution lines landed in this phase-close commit (per Tier 5 plan §5.2/§5.3 acceptance: "marked Resolved with this commit's sha"; the lag-by-1 self-reference convention deferred sha backfill from the work commits to /phase-close).

**Test-count delta across Phase 5:** workspace held at **1135 + 3 skipped** throughout. 5.1–5.3 were doc-only; 5.4–5.7 were markdown-only (no test files); 5.8 deleted untested code (the stub command had no tests of its own).

**Cumulative across the upgrade arc** (Tiers 1 → 5):

- **Twenty-five issues moved Open → Resolved** — Tier 1 (U001-U003, U014-U017); Tier 2 (U004, U011-U013, U023); Tier 3 (U006-U010, U022); Tier 4 (U018-U021); Tier 5 (U024, U025). UPGRADE/ISSUES.md "Open" now contains only **U005** again (`factory chat` REPL turn timeout 120s — out-of-arc; the resolution-text "Tier 2 or 4. Pair with the chat surface work." is now stale since both shipped without addressing it; re-tier candidate for Tier 6).
- **Three new ADRs across the arc:** 0027 / 0028 / 0029 (all from Phase 3). Phase 4 and Phase 5 added zero — the runtime contracts in question were already pinned by 0001-0026 + the three Phase 3 ADRs.
- **All nine active agent prompts factory5-native:** triage, architect, planner, scaffolder, verifier (substantive pre-Tier-5); reviewer, fixer, investigator (written from scratch in 5.4–5.6); builder (fleshed out in 5.7 with venv preservation). The `prompts/agents/README.md` table now reflects reality.
- **One CLI command retired** as part of the audit-driven cleanup (`factory logs`, Tier 5 step 5.8). The CLI README's stub column is gone.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (1135 passing + 3 skipped; 13 packages green; per-package counts unchanged from end-of-Phase-4)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- All four `pnpm` gates re-verified at /phase-close.

**What's next:**

The upgrade arc is complete (again). Operator's options:

1. **Open Tier 6 — skills review + rewrites** (the strongest candidate). All 12 skills in `skills/` are explicitly "ported from factory2/skills/" per `docs/SKILLS.md`. Tier 5's 5.4–5.7 prompt rewrites referenced 6 of those skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) without surfacing hot-fix-worthy drift; an audit-only pass might confirm they're clean, or might surface drift that warrants rewrites. Sized as 1–2 sessions per `UPGRADE/plans/tier-5-agent-prompts.md` Out-of-scope section. Companion candidate: wire the `fixer→updateFindingStatus` parser path that Tier 5's 5.5 confirmed doesn't exist.
2. **Promote a carry-forward item** — see `STATE.md` "In-flight work" + the carry-forward list below.
3. **Park** — surfaces are stable; nothing is gated on more work.

**Carry-forward at arc-end** (none load-bearing, none gating any current work):

- **`fixer→updateFindingStatus` parser path** — Tier 6 companion to skills review; would give the operator/CLI a real "mark FIXED" verb without manual `findings.json` edits.
- **U005 chat 120s timeout re-tier** — affects channel-chat UX directly; "Tier 2 or 4" resolution text is now stale.
- **§6.4 ONBOARDING.md "SPA's polling fetch" reference** — chat.astro consumes SSE today; mildly stale, not load-bearing.
- **ADR 0027 §1 doesn't pin POST `/api/v1/projects`** — ADR-amend candidate; doc-debt only.
- **ADR 0002 footnote about `factory logs`** — supersede-with-new-ADR candidate; over-engineering for one footnote.
- **Pause primitive on directive detail** — defer-until-signal.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page sweep; ~1 commit when authored.
- **Brain-side `log.line` forwarder** — selective pino-stream tap; ADR 0029 future-work.
- **Pre-3.5 baseline live-smoke chat-page click-test** — 30s click-test deferred during Phase 3.10 close.
- **Smoke residue:** `node-sse-smoke` + `smoke-demo` projects in workspace.
- **Filter-form Apply buttons + "Clear all defaults"** — absorbed by deferred PageShell migration.
- **Inline `style=` attributes** scattered across web pages — same migration absorbs these.
- **Control framework 2.2.3 publish** at `G:\Projects\Small-Projects\Control` — operator owns the go.
- **`/session-end` skill structural fix** for the lag-by-1 — now **14 occurrences** with this phase-close commit. Two structural options unchanged.

**Tier 5 in retrospect:** clean execution of an audit-driven addendum to a "complete" arc. 8 work commits in one session + 1 phase-close commit. ~1100 lines added. All 4 `pnpm` gates green throughout. Pre-write homework saved 1–2 ADRs by confirming runtime contracts were already unambiguous. The "build new for factory5, don't port from factory2" directive held — every prompt cites current ADRs (0018, 0021, 0024, 0027, 0028, 0029) + skills (`tdd`, `code-review`, `error-recovery`, `ask-user`, `progress-tracking`, `work-verification`) by name; no factory2 references in any prompt body. The audit pattern itself is reusable: post-arc audits will likely surface similar staleness in any future tier closure, so a periodic Tier-N+1 audit-driven cleanup is a defensible cadence.

---

## 2026-05-06 — Phase 4 (cli-completion) closed; **factory5 first-class upgrade arc complete**

`/phase-close` ran on the Phase 4 work. All nine sub-steps shipped (4.1 → 4.8 in this and the prior session, plus this 4.9 close). Tagged `phase-4-cli-completion-closed` (annotated) at `28c0188`. **No Phase 5 scaffolded — `phase-plan.md` defines only four phases (doc-sweep / channel-parity / web-ui / cli-completion); the upgrade arc is complete.** STATE.md transitions to "all phases complete".

**What shipped in Phase 4** (cumulative across sessions, summarized for the upgrade-side narrative):

- **4.1** — Verified `factory cancel <directive-id>` end-to-end against a live factoryd (Phase 2.4's plumbing already shipped). Live smoke confirmed the 4-code exit surface (0 OK / 1 generic / 2 not-found / 3 already-terminal) — more granular than the 3-code shape originally sketched in the tier-4 plan; matches `factory ui-token`'s shape. Tightened steps.md + tier-4 plan to the live 4-code surface.
- **4.2** — `factory budget set <project> --max-usd <n> [--max-steps <n>]`. New `packages/cli/src/commands/budget.ts` reusing `@factory5/wiki`'s `updateProjectMetadata` — same code path as the daemon's `PUT /api/v1/projects/:id/budget` route (ADR 0027). **Per-field merge** is the distinguishing CLI semantic: passing only `--max-steps` preserves an existing `maxUsd` (web UI's PUT remains full-document replacement; divergence intentional and called out in the README). 15 unit tests.
- **4.3** — `factory project list / show <name> / delete <name>`. Three pure handlers + Commander wiring. `list` enriches each registry row with on-disk language + most-recent build; `show` resolves a project ref (name-first / full-ULID-second; ambiguous names error) and pretty-prints registry + on-disk metadata + last build; `delete` defaults to non-destructive `y/N`-prompted unregister; `--force` skips the prompt; `--purge` adds a typed-name second confirm and `rm -rf`s the workspace dir (order: registry-first-then-rm so a failed rm leaves a clean registry). New `packages/state/src/queries/projects.ts:remove`. 22 unit tests via injectable `prompt` fn.
- **4.4** — `factory ask "<question>"`. Single-shot chat — mints one chat directive, awaits the brain's reply, prints, exits. `--json` emits `{ directive, reply, status[, directiveStatus] }`. Refactored chat.ts to extract `submitOneDirective` helper (mint + notify + reply-poll cycle) — chat REPL loops over the helper, ask calls it once. 7 tests via the notify-injection trick (the test's notify hook either enqueues an outbound row or flips the directive's status — avoids race conditions in the polling loop).
- **4.5** — Tab completion for bash / zsh / pwsh via `factory completion <shell>`. Static surface — 19 top-level commands + 7 nested groups. Single source of truth (`TOP_LEVEL_COMMANDS` + `NESTED_SUBCOMMANDS`) drives all three template generators. Dynamic completion (project names, directive ids) intentionally deferred — would require running `factory` inside the completion script. 9 unit tests pin the structural invariants.
- **4.6** — Rich `--help` examples on every command via `addHelpText('after', ...)`. Top-level `factory --help` `addHelpText('afterAll', ...)` points at `docs/WORKFLOWS.md`. New help-coverage gate at `packages/cli/src/help-coverage.test.ts` (2 tests) walks the Commander tree via `cmd.outputHelp()` with a captured writer (since `helpInformation()` alone misses event-driven addHelpText content). **Sonic-boom-on-help flush race fixed** in `apps/factory/src/main.ts` via argv-sniff: help/version paths skip the async logger init so synchronous `process.exit` doesn't lose the buffered transport bind.
- **4.7** — `packages/cli/README.md` refresh: five new rows in the subcommand table (cancel, ask, budget set, project, completion) + dedicated sections for each + a top-level Tab completion section with bash/zsh/pwsh install one-liners. Top-level intro now points at `docs/WORKFLOWS.md`.
- **4.8** — U018 / U019 / U020 / U021 moved Open → Resolved with full Resolution lines pointing at this arc's commits. Tier 4 ROADMAP rows already ticked in per-step work commits.
- **4.9** — `/phase-close` (this commit's structural close).

**ADRs decided in Phase 4:** none. Tier 4 plan flagged three likely candidates — each landed as a sane-default decision matching the plan; recorded inline in commit bodies (4.5 static-only completion; 4.3 default-non-destructive delete with `--force`/`--purge`; 4.4 JSON shape `{directive, reply, status[, directiveStatus]}`). The relative scarcity of new ADRs across the whole arc (only 0027 / 0028 / 0029, all in Phase 3) reflects how much the 0001-0026 prior corpus already pinned.

**Issues closed in Phase 4:** U018 (rich --help), U019 (tab completion), U020 (project commands), U021 (budget set). All moved Open → Resolved with full Resolution lines pointing at the per-step close commits.

**Test-count delta across Phase 4:** workspace 1080 → **1135 + 3 skipped** (+55 across the phase: +15 budget, +22 project, +7 ask, +9 completion, +2 help-coverage). CLI package alone: 78 → 133.

**Cumulative across the upgrade arc** (Tiers 1 → 4):

- **Twenty-three issues moved Open → Resolved** — Tier 1 (U001-U003, U014-U017); Tier 2 (U004, U011-U013, U023); Tier 3 (U006-U010, U022); Tier 4 (U018-U021). UPGRADE/ISSUES.md "Open" now contains only **U005** (`factory chat` REPL turn timeout 120s — out of upgrade-arc scope; sized as future Tier 2/4 follow-up if a demand signal surfaces).
- **Three new ADRs:** 0027 (web-ui-mutation-surface), 0028 (worker-sandbox-contract), 0029 (directive-stream-protocol — promoted past gated state at Phase 3 close).
- **Four operator surfaces at parity for the eight-intent vocabulary:** CLI, Discord, Telegram, web dashboard. Each can build / chat / status / spend / findings / resume / cancel / budget. Live SSE wiring on the web side; tab completion + rich `--help` on the CLI side.
- **One Astro component library** (`<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<Field>`, `<Submit>`, `<PageShell>`); all 10 web pages converted to use it; `el()` / `loadInto()` retired from `lib/api.ts`.
- **One shared chat protocol:** `command-handlers.ts` is the single dispatcher routing slash-prefixed reads (status / spend / findings) across Discord, Telegram, and web-chat — surfaces never drift.
- **`/phase-close` housekeeping (this commit)** at `28c0188`: U018-U021 already moved to Resolved in 4.8; ROADMAP already ticked per-step; steps.md `[x] 4.9`; STATE.md → "all phases complete"; journal entry; carry-forward "Deferred to Phase 5" section uses the `<item>` placeholder verbatim, so no carry-forward bullets get seeded into a non-existent Phase 5 README. Annotated tag `phase-4-cli-completion-closed` at the close commit.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (state 157, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli **133**, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. Total **1135 passing + 3 skipped**.)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- All four `pnpm` gates green at `/phase-close` verification.

**What's next:**

The upgrade arc is complete. Operator's options:

1. **Open a new arc** — author a fresh `UPGRADE/plans/tier-5-<name>.md`, add a Phase 5 row to `.control/architecture/phase-plan.md`, then scaffold `.control/phases/phase-5-<name>/{README.md,steps.md}` from `.control/templates/`.
2. **Promote a carry-forward item to a Tier-5+ ROADMAP entry** — see "Carry-forward" below; each ships as ~1 commit when authored.
3. **Park** — surfaces are stable; nothing is gated on more work.

**Carry-forward at arc-end** (none load-bearing, none gating any current work):

- **Pause primitive on directive detail** — defer until a real workflow signal surfaces; cancel solved the primary "kill the build" pain. Two design options unchanged.
- **PageShell adoption + Dashboard `<style is:global>` migration** — 11-page sweep absorbing the unstyled "Clear all defaults" + 4× filter-form Apply buttons + inline-style audit. Self-contained ~1 commit.
- **Brain-side `log.line` forwarder** — selective pino-stream tap; ADR 0029 future-work item.
- **Chat-page click-test** — 30-second smoke; final piece of Phase 3.5's pre-existing baseline.
- **U005** — `factory chat` 120 s turn timeout (extend or replace with streaming).
- **Control framework 2.2.3 publish** at `G:\Projects\Small-Projects\Control` — operator owns the go.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 self-reference drift (now **11 occurrences**).

**Auto-mode session shape worth recording.** This session ran in auto mode after one initial "proceed" — three steps closed in sequence (4.7 README + 4.8 issues + /phase-close) including the destructive-feeling annotated tag. The runbook clarity made it safe: each step had explicit acceptance criteria, the gates were re-verified at the right boundaries, and the close commit's done-criteria check was 11/11 before tagging. The pattern works for end-of-arc steps where the cursor is mechanical; it would not have been right for any step that needed operator judgement (a new ADR, a UX call, a destructive cleanup). Documented for future arc finales.

---

## 2026-05-06 — Phase 3 (web-ui) closed; Phase 4 (cli-completion) kicked off

`/phase-close` ran on the Phase 3 work. All ten sub-steps shipped across the prior multi-session arc (3.1 → 3.10); 3.11 was `/phase-close` itself. Tagged `phase-3-web-ui-closed` (annotated) at the close commit. Phase 4 (cli-completion) scaffolded.

**What shipped in Phase 3** (cumulative across sessions, summarized for the upgrade-side narrative):

- **3.1 / 3.2** — SSE on `GET /api/v1/directives/:id/stream` (six event types, per-directive `DirectiveStreamHub` subscription map, 15 s `:keepalive` heartbeats, backfill burst on connect); `directives/detail.astro` consumes via `EventSource` with `?t=` token accommodation; polling fallback for SSE-stripped proxies. Pinned by ADR 0029.
- **3.3 / 3.4** — Astro component library (`<Card>`, `<Table>`, `<EmptyState>`, `<Alert>`, `<Form>`, `<Field>`, `<Submit>`, `<PageShell>`); all 10 pages converted; `el()` and `loadInto()` retired from `lib/api.ts`. Slot-content CSS-scoping discovery captured in `apps/factory-web/src/components/README.md`.
- **3.5** — `/app/chat` page mirrors `factory chat` end-to-end against a real factoryd; new `POST /api/v1/chat/messages` route mints `intent=chat` directives; page subscribes to the same SSE stream for token-by-token reply rendering; slash-prefixed reads route through Phase 2's shared `command-handlers.ts` so Discord, Telegram, and web-chat never drift.
- **3.6** — Cancel button on directive detail page; `POST /api/v1/directives/:id/cancel` (SPA-namespace alias of Phase 2's CLI route, gated by `requireUiAuth`); operator clicks Cancel, daemon mutates `directives.status`, brain emits `directive.completed`, hub forwards to the open SSE client, FE re-renders within ~2 s end-to-end (live-smoke verified). Pause primitive deferred — operator workflow signal not yet present.
- **3.7** — `/app/projects/new` page mirrors `factory init <project>` for a single project; `wiki.createProject` extraction + `POST /api/v1/projects` daemon route; `apiV1CreateProjectRequestSchema` in `@factory5/ipc`. Live smoke against `node-sse-smoke` build also confirmed `finding.created` end-to-end (F001 emitted live by the assessor), closing ADR 0029's live-verification gap.
- **3.8** — Spend page charts: per-project sparkline (240×28 SVG, last 14 days, discrete segments + dots so zero-spend days render as visible gaps not connecting through zero) + 30-day stacked bar (720×180 SVG, native `<title>` tooltips, per-day invisible hover targets, deterministic-hue palette per `projectId` hash). New `spend.perDayPerProject(db, filter?)` rollup helper; +5 tests.
- **3.9** — Mobile-responsive nav: `<details>`-based hamburger drawer at ≤768px (zero JS, native a11y, 44×44 px tap target); `@media (max-width: 640px)` form-row stacking; `Table.astro` `.table-wrap` overflow-x for wide data tables. Plan-vs-steps.md numbering offset surfaced and documented (steps.md is the cursor).
- **3.10** — Explicit logout + connection-status pip in header: layout-level 30 s heartbeat on `/api/v1/status` drives a colored pip (green Connected / amber Reconnecting / red Disconnected/Signed out); theme-independent traffic-light colors; logged-out banner; stale-token (401) short-circuit names `factory ui-token` as the recovery command in the hover tooltip. The 401 short-circuit was a follow-up fix surfaced in operator smoke — the lesson recorded was "error-class differentiation matters when recovery paths differ."

**ADRs decided in Phase 3:**

- **ADR 0027** — web-ui-mutation-surface (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`).
- **ADR 0028** — worker-sandbox-contract (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn).
- **ADR 0029** — directive-stream-protocol — promoted past gated state at this `/phase-close` (Live verification table now ✅ for all six event types; unit-test-only carve-out retired).

**Issues closed at /phase-close:** U006 (no live updates), U007 (no chat surface), U008 (DOM-builder pattern), U009 (no mobile design), U010 (sessionStorage UX), U022 (`el()` setAttribute escaping). All moved from Open to Resolved with full Resolution lines pointing at the per-step close commits.

**Test-count delta across Phase 3:** workspace 1063 → 1080 + 3 skipped (+17 cumulative; +5 in 3.7's wiki + daemon, +5 in 3.8's `perDayPerProject` state coverage; the rest from 3.1-3.6's per-step adds; 3.9 + 3.10 were layout-only with zero test deltas).

**`/phase-close` housekeeping (this commit):**

- Six issues moved Open → Resolved in `UPGRADE/ISSUES.md`.
- ADR 0029 amended: Live verification table updated, `finding.created` caveat paragraph removed, Negative-consequence bullet removed, Implementation-status future-work list trimmed.
- Phase 3 README's `## ADRs decided in this phase` populated (0027 / 0028 / 0029); `## Deferred to Phase 4 (or later)` populated with three carry-forward items (Pause primitive; PageShell + `<style is:global>` migration; brain-side `log.line` forwarder).
- Phase 3 `steps.md` 3.11 → `[x]`.
- Phase 4 scaffolded at `.control/phases/phase-4-cli-completion/{README.md,steps.md}` from templates + `phase-plan.md` Phase 4 entry + `tier-4-cli-completion.md` plan; carry-forward block auto-seeded into Phase 4 README's `## Why this phase exists`.
- STATE.md → Phase 4, step 4.1.
- Tier 3 ROADMAP boxes were already fully ticked through step-3.10 close — no remaining work.
- Annotated tag `phase-3-web-ui-closed` at the close commit.

**State of `main` at session end:**

- `pnpm build` ✅
- `pnpm test` ✅ (state 157, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 78, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. Total **1080 passing + 3 skipped**.)
- `pnpm lint` ✅
- `pnpm format:check` ✅
- `apps/factory-web` builds clean.
- All four `pnpm` gates green at `/phase-close` verification.

**What's next (Phase 4):**

1. **Operator pre-kickoff edits to Phase 4 README** — fill `## Where we were, end of Phase 3` (terse summary of the 10-step Phase 3 arc) and the operator-motivation paragraph in `## Why this phase exists` (above the auto-seeded carry-forward block).
2. **Step 4.1** — Verify `factory cancel <directive-id>` end-to-end. Phase 2's plumbing already shipped; this is a smoke-only verification commit (or a small fix if needed).
3. **Step 4.2** — `factory budget set <project>` (the first feature step). Reuses `packages/wiki/src/project-metadata.ts`; same code path as the web UI's `PUT /api/v1/projects/:id/budget`.

Phase 4 estimate: ~1 session. Most of the heavy lifting (cancel plumbing) shipped in Tier 2; Phase 4 is feature-completion + polish.

**Carry-forward items captured in the new Phase 4 README's `## Why this phase exists`** (none block any 4.x step):

- Pause primitive on directive detail (defer-until-signal).
- PageShell adoption + Dashboard `<style is:global>` migration (1-commit sweep, available any time).
- Brain-side `log.line` forwarder (ADR 0029 future-work item).

**Other carry-forward not specifically deferred from Phase 3:**

- Pre-3.5 baseline live-smoke (chat-page click-test) — Phase 3's chat page passes its 3.5 unit + integration coverage and ADR 0029's live-verification is closed, so this is no longer a Phase 3 acceptance gate. Natural fit during Phase 4 if the operator wants a visual check while testing CLI commands.
- Smoke residue cleanup — Phase 4's `factory project delete --purge` (step 4.3) will be the right tool once it ships.
- `/session-end` skill structural fix for the "Last commit" lag-by-1 drift (8 occurrences).
- Control framework repo 2.2.3 publish (operator's go).

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
