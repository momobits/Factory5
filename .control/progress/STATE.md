# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-06 22:30 UTC by `/session-end` (Phase 4 mid-flight — 6 of 9 sub-steps closed in this session: 4.1 → 4.6; 4.7-4.9 carry to next session)
**Current phase:** 4 — cli-completion
**Current step:** 4.7 — `packages/cli/README.md` refresh (next session)
**Status:** ready (clean working tree post 4.6 close; all four `pnpm` gates green; workspace test count 1135 + 3 skipped)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Step 4.7 — refresh [`../../packages/cli/README.md`](../../packages/cli/README.md) to document the five new (or newly-verified) commands shipped in this session: `cancel`, `ask`, `budget set`, `project list/show/delete`, `completion`. Add a Tab completion install section (bash / zsh / pwsh one-liners). Add a row to the subcommand table for each of them. Update `Exit codes:` blocks to match the 4-code surfaces (`cancel` 0/1/2/3; `budget set` 0/1/2; `project delete` 0/1/2; `ask` 0/1/2). Cross-reference [`../../docs/WORKFLOWS.md`](../../docs/WORKFLOWS.md) for the canonical operator loops. **One file, no tests, ~1 commit.** After 4.7: 4.8 (move issues U018-U021 Open → Resolved + verify Tier 4 ROADMAP boxes are all ticked) then 4.9 (`/phase-close` — tag `phase-4-cli-completion-closed`).

---

## Git state

- **Branch:** main
- **Last commit:** `91eebca` — docs(4.6): rich --help examples on every command
- **Uncommitted changes:** none (clean post 4.6 close; this session-end's `docs(state)` commit will create the 10th occurrence of the documented post-session-end self-reference lag-by-1 — STATE.md will then reference `91eebca` while HEAD will point at the session-end commit)
- **Last phase tag:** `phase-3-web-ui-closed` (annotated tag at `5fbcfb1`)

---

## Open blockers

- None

---

## In-flight work

None — six sub-steps closed cleanly in sequence (4.1 → 4.6), each with its own commit + checkbox + ROADMAP tick. Cursor moves to 4.7.

Carry-forward items outside the work cursor (none block 4.7-4.9):

- **Phase 3 deferred follow-ups (carried into Phase 4 README):** (1) Pause primitive on directive detail (defer until workflow signal); (2) PageShell adoption + Dashboard `<style is:global>` migration (11-page sweep); (3) Brain-side `log.line` forwarder (ADR 0029 future-work). None gate Phase 4.
- **Pre-3.5 baseline live-smoke (chat-page click-test)** — still pending; natural fit during a Phase-4 visual-check break, but not gating.
- **Smoke residue:** `node-sse-smoke` + `smoke-demo` projects at `C:\Users\Momo\factory5-workspace\<name>\`; cancelled directives in DB. Step 4.3 shipped `factory project delete --purge` which is the right tool for clearing this — operator can use it directly any time.
- **Filter-form Apply buttons + "Clear all defaults"** still render as user-agent default `<button>` on five sites — absorbed by the deferred PageShell migration.
- **Inline `style=` attributes** scattered across pages — same PageShell migration absorbs these.
- **Control framework repo** (`G:\Projects\Small-Projects\Control`) still has uncommitted upstream patches matching local `e5ec723`. Operator owns the go for 2.2.2 → 2.2.3 publish.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 self-reference drift remains unaddressed across 9 occurrences (the 10th lands at this session-end). Two structural options unchanged: track "last work commit" rather than HEAD, or amend STATE.md post-commit. Worth filing as ergonomic infrastructure work — no tier-budget impact.

---

## Test / eval status

- **Last test run:** 2026-05-06 (post 4.6 close) — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. **CLI test count 78 → 133** across this session (+15 budget, +22 project, +7 ask, +9 completion, +2 help-coverage). Per-package: state 157, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 133, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1135 passing + 3 skipped** (was 1080 at phase-3 close).
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness. ADR 0029 in promoted state since `/phase-close` of Phase 3.

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05; promoted past gated state 2026-05-06 at `/phase-close`) — Live verification carve-out retired. Six event types confirmed live end-to-end.
- **ADR 0028 — worker-sandbox-contract** (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- **ADR 0027 — web-ui-mutation-surface** (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

No new ADRs this session — Tier 4 plan flagged three likely candidates (tab-completion scope; project delete semantics; ask JSON output shape) but each was a sane-default decision matching the plan; none rose to ADR-worthy. Recorded inline in commit bodies (4.5 static-only completion; 4.3 default-non-destructive delete with `--force`/`--purge`; 4.4 JSON shape `{directive, reply, status[, directiveStatus]}`).

---

## Recently completed (last 5 steps)

- Step 4.6 close — `docs(4.6)`: rich --help examples on every command. Every leaf command's `--help` now ends with `Examples:` (and Exit codes: where applicable). Top-level `factory --help` `addHelpText('afterAll', ...)` points at `docs/WORKFLOWS.md`. New help-coverage gate at `packages/cli/src/help-coverage.test.ts` (2 tests) walks the Commander tree via `cmd.outputHelp()` with a captured writer (since `helpInformation()` alone misses event-driven addHelpText content). **Sonic-boom-on-help flush race fixed:** `apps/factory/src/main.ts` argv-sniffs for `-h`/`--help`/`-V`/`--version` and inits the logger with `noFile: true, noConsole: true` on those paths, so on-exit-leak-free's exit hook is a no-op. `factory --help` / `factory build --help` / `factory cancel --help` all exit 0 cleanly now (were exit 1 with a sonic-boom error trailer). 24 files, +367/-4 lines. — 2026-05-06 — `91eebca`
- Step 4.5 close — `feat(4.5)`: tab completion for bash/zsh/pwsh. New `factory completion <shell>` command emitting self-contained completion scripts. Static surface — 19 top-level commands + 7 nested groups (`budget set`, `daemon start|stop|status|restart`, `directive mark-blocked`, `findings list|show|backfill`, `project list|show|delete`, `questions cleanup`, `completion bash|zsh|pwsh`). Single source of truth — `TOP_LEVEL_COMMANDS` + `NESTED_SUBCOMMANDS` constants drive all three templates. 9 tests; live smoke confirmed bash output + unknown-shell error. — 2026-05-06 — `9340cfd`
- Step 4.4 close — `feat(4.4)`: factory ask "<question>" + `chore(4.4)`: prettier reflow on project.ts (whitespace only). Single-shot chat — mints one chat directive, awaits the brain's reply, prints, exits. `--json` emits `{ directive, reply, status[, directiveStatus] }` for scripting. Refactored chat.ts to extract `submitOneDirective` helper (mint + notify + reply-poll cycle). Chat REPL now loops over the helper; ask calls it once. 7 tests cover plain + --json crossed with reply / timeout / terminal-no-reply via notify-injection trick. — 2026-05-06 — `e07c7a0` + `caba5d5`
- Step 4.3 close — `feat(4.3)`: factory project list/show/delete. Three subcommands under `factory project`: `list` walks projectsQ.listAll + enriches with on-disk language and most-recent build; `show` resolves by name/ULID, pretty-prints registry + project.json + last build; `delete` defaults to interactive unregister-only, `--force` skips prompt, `--purge` adds typed-name double-confirm + rm -rf. New `projectsQ.remove(db, id)` in state package (no FK cascade per migration 006 §implementation note). Order on `--purge`: unregister first, then rm -rf. 22 tests; tmpdir-rooted workspaces; canned-response prompt stubs cover approve/decline/wrong-name paths. — 2026-05-06 — `9da25ba`
- Step 4.2 close — `feat(4.2)`: factory budget set <project>. CLI sibling of the web UI's `PUT /api/v1/projects/:id/budget` (ADR 0027). Same `updateProjectMetadata` helper. **Per-field merge** (CLI semantics — differs from web's full-doc replacement): `--max-steps 100` keeps an existing `maxUsd`; idempotent. Validation via `projectBudgetDefaultsSchema`. Project resolution: name → full ULID; ambiguous name → exit 2 with disambiguation list. 15 tests covering all merge directions, idempotence, both Wiki error classes (ProjectMetadataNotFoundError + ProjectMetadataCorruptError), full-ULID resolution. — 2026-05-06 — `fa28e6d`

(Step 4.1 — `chore(4.1)`: verify factory cancel CLI surface end-to-end at `7a970b5` — also closed this session; trimmed from the last-5 view to make room for 4.2-4.6.)

---

## Attempts that didn't work (current step only)

- None on the cursor (4.7 hasn't started). Cleared on phase-internal step transitions.

Worth recording from this session for future reference:

- **`helpInformation()` doesn't include `addHelpText` content** — discovered when authoring 4.6's help-coverage test. The auto-generated layout returned by `helpInformation()` is just the Usage / Description / Options block; the addHelpText text fires on the `afterHelp` / `afterAllHelp` events that `outputHelp()` emits to a context writer. Fix in the test: capture `outputHelp()` output via `cmd.configureOutput({ writeOut, writeErr })`. Worth knowing for any future Commander-help test work.
- **Sonic-boom isn't ready synchronously** — pino's default sonic-boom transport opens its destination async. If `process.exit()` fires before the open completes, on-exit-leak-free's hook calls `flushSync()` which throws "sonic boom is not ready yet". The fix in `apps/factory/src/main.ts` argv-sniffs for help/version paths and inits the logger with `noFile: true, noConsole: true` on those paths. The other synchronous-exit paths (e.g., `factory cancel <not-found-id>`) get enough async work in between (DB open, IPC) that sonic-boom finishes opening — only true synchronous-exit paths (`--help`, `--version`) need the suppressor.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x, Commander 12.x
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host
- **Background processes still running:** `factoryd` on `127.0.0.1:25295` (pid 41888 confirmed during 4.1's live smoke; uptime ~16h then; will have rolled over by next session). Get live URL via `factory ui-token`. Astro dev on `127.0.0.1:4321` not used by the remaining 4.x steps (CLI + README only).

---

## Notes for next session

Phase 4 is **6 of 9 sub-steps closed** (4.1 → 4.6). Three remain:

**Step 4.7 — `packages/cli/README.md` refresh (recommended start):**

Touch one file. Add documentation for the new commands shipped this session:

- `factory cancel <directive-id> [--reason <text>]` — exit codes 0/1/2/3.
- `factory ask "<question>"` — single-shot chat, `--json` shape.
- `factory budget set <project> --max-usd <n> [--max-steps <n>]` — per-field merge, exit codes.
- `factory project list / show <name> / delete <name>` — `--force` and `--purge` semantics.
- `factory completion <shell>` — install one-liners for bash / zsh / pwsh.

Add a Tab completion top-level section. Update the subcommand table (which is missing the five new rows). Cross-reference `docs/WORKFLOWS.md` for canonical operator loops. Suggested commit: `docs(cli): packages/cli/README.md — refresh after Tier 4` (or `docs(4.7)`).

**Step 4.8 — Resolve U018-U021 + verify ROADMAP ticks:**

Move issues U018 (rich --help), U019 (tab completion), U020 (project commands), U021 (budget set) from Open → Resolved in [`../../UPGRADE/ISSUES.md`](../../UPGRADE/ISSUES.md) with full Resolution lines pointing at this session's commits (`91eebca` for U018, `9340cfd` for U019, `9da25ba` for U020, `fa28e6d` for U021). Verify all six Tier 4 ROADMAP rows are ticked (cancel `9da25ba` 4.5; budget `fa28e6d` 4.2; project `9da25ba` 4.3; ask was implicit via this session — should be ticked already; tab completion `9340cfd` 4.5 ✅; rich --help `91eebca` 4.6 ✅). Suggested commit: `chore(4.8): resolve U018-U021 + tick Tier 4 ROADMAP`.

**Step 4.9 — `/phase-close`:**

Run after 4.7 + 4.8. Tag `phase-4-cli-completion-closed`. The phase-close runbook will scaffold Phase 5 if a phase-plan.md entry exists, otherwise the upgrade arc closes out and STATE.md transitions to "all phases complete".

**Estimate:** all three remaining steps fit comfortably in a single short session (~1 hour of session time). 4.7 is a single-file doc edit; 4.8 is mechanical issue moves; 4.9 is `/phase-close`.

**Carry-forward items (still don't block):** Pause primitive; PageShell + `<style is:global>` migration (1-commit sweep); brain-side `log.line` forwarder; chat-page click-test; Control framework 2.2.3 publish; `/session-end` skill lag-by-1 fix (now 10 occurrences).

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions.

**Frontend-design judgement calls** carried from Phase 3 — not load-bearing for the remaining 4.x steps (CLI/docs only) but worth recalling for any future web-side work: smart defaults beat empty states; native HTML beats custom widgets; theme-independent intentional colors for status semantics; error-class differentiation; visible-label vs. hover-title separation; inherit-don't-invent; root-cause CSS over global rewrites; hint-copy-teaches-consequence; in-context-affordance vs nav.
