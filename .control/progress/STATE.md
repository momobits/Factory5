# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-06 21:30 UTC by `/phase-close` (Phase 4 closed; upgrade arc complete — `phase-plan.md` defines only Phases 1-4, no Phase 5 scaffolded)
**Current phase:** — (all four phases closed; no Phase 5 scheduled)
**Current step:** — (no active cursor)
**Status:** complete (all four `pnpm` gates green; clean working tree post phase-close commit; workspace test count 1135 passing + 3 skipped; `phase-4-cli-completion-closed` tagged at this commit)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

The factory5 first-class upgrade arc that ran from Tier 1 (doc-sweep) through Tier 4 (cli-completion) is complete. Four operator surfaces — CLI, Discord, Telegram, web dashboard — now reach feature parity for the eight-intent vocabulary; live SSE wiring on the web side; tab completion + rich `--help` on the CLI side; one Astro component library; one shared chat protocol. ADRs 0027 / 0028 / 0029 codify the pinned contracts.

No new phase is scaffolded. Operator's options:

1. **Open a new arc** — author a fresh `UPGRADE/plans/tier-5-<name>.md`, add a Phase 5 row to `.control/architecture/phase-plan.md`, then run `/phase-add` (if Control supports it) or hand-scaffold `.control/phases/phase-5-<name>/{README.md,steps.md}` from `.control/templates/`.
2. **Promote a carry-forward item to a Tier-5+ ROADMAP entry** — see "In-flight work" below; each is small and self-contained, ships as ~1 commit when authored.
3. **Park** — surfaces are stable; nothing is gated on more work.

**Recommended `/session-end`** next so STATE.md / journal.md / next.md / UPGRADE/LOG.md all transition together to the post-arc state. The phase-close commit landed the structural transition; `/session-end` records the operator-side handoff for whoever picks up next.

---

## Git state

- **Branch:** main
- **Last commit:** `<phase-close-sha>` — chore(phase-4): close phase 4 (final phase — upgrade arc complete)
- **Uncommitted changes:** none (clean post phase-close commit)
- **Last phase tag:** `phase-4-cli-completion-closed` (annotated tag at the phase-close commit; final upgrade-arc tag)

---

## Open blockers

- None

---

## In-flight work

None — Phase 4 closed cleanly with all nine sub-steps shipped (4.1 → 4.9). Cursor is parked.

Carry-forward items outside the work cursor (none gating any current phase; ordered by likelihood a demand signal surfaces):

- **Pause primitive on directive detail** — deferred from Phase 3.6 per the Phase 3 README's "Deferred to Phase 4" carry-forward, then carried into Phase 4's "Why this phase exists" but not pulled into a 4.x step (cancel solved the primary "kill the build" pain). When the signal lands, choose between (a) extending `directivesQ.status` with `paused`/resume + brain claim-loop skip + 2 new IPC routes + 2 buttons, or (b) reusing `markBlocked` with `blockedReason: 'paused-by-operator'`.
- **PageShell + Dashboard `<style is:global>` migration** — 11-page structural sweep absorbing the unstyled "Clear all defaults" + 4× filter-form Apply buttons issue, consolidating inline `style=` attributes, and moving Dashboard's currently-scoped `.btn*` / `.alert*` / `.form-*` rules to global so slot-level page elements pick them up. Self-contained; ships as ~1 commit when authored.
- **Brain-side `log.line` forwarder** — selective pino-stream tap filtered by `correlationId` so the FE log tail uses live SSE events instead of polling fallback. Pinned in ADR 0029 future-work; not blocking any operator workflow.
- **Pre-3.5 baseline live-smoke chat-page click-test** — 30-second click-test confirming `/app/chat` end-to-end over the same SSE protocol; deferred during Phase 3.10 close.
- **Smoke residue:** `node-sse-smoke` + `smoke-demo` projects at `C:\Users\Momo\factory5-workspace\<name>\`; cancelled directives in DB. Phase 4.3's `factory project delete --purge` is the right tool for clearing this — operator can use it directly any time.
- **Filter-form Apply buttons + "Clear all defaults"** still render as user-agent default `<button>` on five sites — absorbed by the deferred PageShell migration.
- **Inline `style=` attributes** scattered across pages — same PageShell migration absorbs these.
- **U005** — `factory chat` REPL turn timeout 120 s (still in `UPGRADE/ISSUES.md` Open). Sized as a future Tier 2/4 follow-up if a demand signal surfaces; fold into a streaming-replies surface vs raise the timeout.
- **Control framework repo** (`G:\Projects\Small-Projects\Control`) still has uncommitted upstream patches matching local `e5ec723`. Operator owns the go for 2.2.2 → 2.2.3 publish.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 self-reference drift remains unaddressed across **11 occurrences** now (counting this phase-close commit, since STATE.md will reference itself). Two structural options unchanged: track "last work commit" rather than HEAD, or amend STATE.md post-commit. Worth filing as ergonomic infrastructure work — no tier-budget impact.

---

## Test / eval status

- **Last test run:** 2026-05-06 (post phase-4 close) — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package: state 157, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 133, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1135 passing + 3 skipped** (held steady from end-of-4.6; 4.7 / 4.8 / 4.9 are docs/state-only, no test deltas).
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness. ADR 0029 in promoted state since `/phase-close` of Phase 3.

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05; promoted past gated state at Phase 3 close 2026-05-06 — six event types confirmed live end-to-end)
- **ADR 0028 — worker-sandbox-contract** (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- **ADR 0027 — web-ui-mutation-surface** (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

No new ADRs in Phase 4. Tier 4 plan flagged three likely candidates — each landed as a sane-default decision matching the plan; recorded inline in commit bodies (4.5 static-only completion; 4.3 default-non-destructive delete with `--force`/`--purge`; 4.4 JSON shape `{directive, reply, status[, directiveStatus]}`).

---

## Recently completed (last 5 steps)

- Step 4.9 close — `chore(phase-4)`: close phase 4 (final phase — upgrade arc complete). Tagged `phase-4-cli-completion-closed`. No `phase-plan.md` entry for Phase 5 → no scaffolding; STATE.md transitions to "all phases complete". Done-criteria verification: 11/11 green (all 4.x steps closed; no `phase:4-blocker` issues; all 4 gates pass; new commands all have unit tests; tab completion produces valid scripts gated by tests; every `--help` shows examples; U018-U021 Resolved; README refreshed; tree clean; commit shapes match `<type>(4.<step>): <subject>`). Phase 4 README's `## Deferred to Phase 5 (or later)` section uses the `<item>` placeholder verbatim, so no carry-forward bullets get seeded into a non-existent Phase 5 README. — 2026-05-06 — `<phase-close-sha>`
- Step 4.8 close — `chore(4.8)`: resolve U018-U021 + verify Tier 4 ROADMAP. Moved U018 (rich --help, `91eebca`), U019 (tab completion, `9340cfd`), U020 (project commands, `9da25ba`), and U021 (budget set, `fa28e6d`) from Open to Resolved with full resolution lines. Tier 4 ROADMAP rows already ticked alongside per-step work commits — no edits there, just verification. — 2026-05-06 — `1d1f6a9`
- Step 4.7 close — `docs(4.7)`: packages/cli/README.md — refresh after Tier 4. Five new rows in the subcommand table (cancel, ask, budget set, project, completion) + dedicated sections for each + a top-level Tab completion section with bash/zsh/pwsh install one-liners. Top-level intro now points at `docs/WORKFLOWS.md` and the Tab completion section. Documents per-field merge in budget set, the unregister-vs-purge contract in project delete, the daemon-up-vs-down paths in cancel, and the JSON shape + status enum in ask. — 2026-05-06 — `4902480`
- Step 4.6 close — `docs(4.6)`: rich --help examples on every command. Every leaf command's `--help` now ends with `Examples:` (and Exit codes: where applicable). Top-level `factory --help` `addHelpText('afterAll', ...)` points at `docs/WORKFLOWS.md`. New help-coverage gate at `packages/cli/src/help-coverage.test.ts` (2 tests) walks the Commander tree via `cmd.outputHelp()` with a captured writer (since `helpInformation()` alone misses event-driven addHelpText content). **Sonic-boom-on-help flush race fixed:** `apps/factory/src/main.ts` argv-sniffs for `-h`/`--help`/`-V`/`--version` and inits the logger with `noFile: true, noConsole: true` on those paths. — 2026-05-06 — `91eebca`
- Step 4.5 close — `feat(4.5)`: tab completion for bash/zsh/pwsh. New `factory completion <shell>` command emitting self-contained completion scripts. Static surface — 19 top-level commands + 7 nested groups. Single source of truth — `TOP_LEVEL_COMMANDS` + `NESTED_SUBCOMMANDS` constants drive all three templates. 9 tests; live smoke confirmed bash output + unknown-shell error. — 2026-05-06 — `9340cfd`

---

## Attempts that didn't work (current step only)

None on the cursor — phase-4 is closed and the cursor is parked. Per-step dead-ends from this session were captured in journal.md's 2026-05-06 entries.

Worth recording from Phase 4 for future reference:

- **`helpInformation()` doesn't include `addHelpText` content** — discovered when authoring 4.6's help-coverage test. The auto-generated layout returned by `helpInformation()` is just the Usage / Description / Options block; the addHelpText text fires on the `afterHelp` / `afterAllHelp` events that `outputHelp()` emits to a context writer. Fix in the test: capture `outputHelp()` output via `cmd.configureOutput({ writeOut, writeErr })`. Worth knowing for any future Commander-help test work.
- **Sonic-boom isn't ready synchronously** — pino's default sonic-boom transport opens its destination async. If `process.exit()` fires before the open completes, on-exit-leak-free's hook calls `flushSync()` which throws "sonic boom is not ready yet". The fix in `apps/factory/src/main.ts` argv-sniffs for help/version paths and inits the logger with `noFile: true, noConsole: true` on those paths. The other synchronous-exit paths (e.g., `factory cancel <not-found-id>`) get enough async work in between (DB open, IPC) that sonic-boom finishes opening — only true synchronous-exit paths (`--help`, `--version`) need the suppressor.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x, Commander 12.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host
- **Background processes still running:** `factoryd` on `127.0.0.1:25295` (pid from 4.1's live smoke long since rolled over). Get live URL via `factory ui-token`. Astro dev on `127.0.0.1:4321` not used by phase-close.

---

## Notes for next session

The factory5 first-class upgrade arc (Tiers 1 → 4) is complete. There is no scheduled Phase 5. The operator opens the next arc when a demand signal surfaces.

If you want to continue working on factory5, the cleanest paths are:

**A. Promote one of the carry-forward items.** Each is small and self-contained:

- _Pause primitive on directive detail_ — when a real workflow signal surfaces, decide between extending `directivesQ.status` with `paused`/resume vs reusing `markBlocked` with `blockedReason: 'paused-by-operator'`.
- _PageShell migration + Dashboard `<style is:global>`_ — 11-page sweep, absorbs filter-form Apply / "Clear all defaults" unstyled-button issue + inline-style audit pass; ships as ~1 commit.
- _Brain-side `log.line` forwarder_ — selective pino-stream tap; ADR 0029 future-work item.
- _Chat-page click-test_ — 30-second smoke; final piece of Phase 3.5's pre-existing baseline.
- _U005 `factory chat` 120 s timeout_ — extend or replace with streaming.
- _Control framework 2.2.3 publish_ at `G:\Projects\Small-Projects\Control` — operator owns the go.
- _`/session-end` skill structural fix_ for the "Last commit" lag-by-1 (now 11 occurrences). Two structural options unchanged: track "last work commit" rather than HEAD, or amend STATE.md post-commit.

**B. Author a new tier.** If a larger arc surfaces (e.g., persistent-session resumption, multi-tenant operator auth, Linux+Mac CI matrix, Pause primitive once a demand signal lands, eval harness for triage / architect / verify), draft a `UPGRADE/plans/tier-5-<name>.md`, add a Phase 5 row to `phase-plan.md`, then run `/phase-add` (or scaffold by hand) to bring the cursor back online.

**C. Park.** Nothing is gated. Walking away is fine; the surfaces are stable and document themselves.

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across all four tiers (~10 sessions). Read [`../../UPGRADE/ROADMAP.md`](../../UPGRADE/ROADMAP.md) for the per-tier acceptance picture.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing (no current web work) but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.
