# Project State

> Single source of truth. Read this first every session. Updated at every
> `/session-end` and by the `PreCompact` hook. Every field has a purpose -- fill each.

**Last updated:** 2026-05-06 13:05 UTC by `/phase-close` (Phase 3 closed; Phase 4 kicked off)
**Current phase:** 4 — cli-completion
**Current step:** 4.1 — Verify `factory cancel <directive-id>` CLI surface end-to-end (or roll directly into 4.2 if 4.1 is verify-only — operator's call at session start)
**Status:** ready (clean working tree post phase-close commit; all four `pnpm` gates green; workspace test count 1080 + 3 skipped at phase-3 close baseline)

---

## Project spec

**Canonical:** `.control/SPEC.md` (v2.0 single-file layout)
**Evolution:** `git log .control/SPEC.md` (and the `## Artifacts (chronological)` section in SPEC.md, populated by `/spec-amend <slug>`)
**Role:** Source of truth for project content. When distilled docs (phase-plan, phase READMEs) disagree with the spec, the spec wins. Newer artifacts in SPEC.md's `## Artifacts` section win over conflicting content in the canonical sections above.

---

## Next action

Begin Phase 4 (cli-completion). Read [`../phases/phase-4-cli-completion/README.md`](../phases/phase-4-cli-completion/README.md) and [`steps.md`](../phases/phase-4-cli-completion/steps.md) plus the full plan at [`../../UPGRADE/plans/tier-4-cli-completion.md`](../../UPGRADE/plans/tier-4-cli-completion.md). Two pre-kickoff items the operator should fill in: (i) `## Where we were, end of Phase 3` section in the new README — terse summary of the 10-step Phase 3 arc that 4.x can rely on (SSE protocol, Astro component library, web cancel/chat/projects-new, mobile nav, logout/connection pip); (ii) `## Why this phase exists` section — the carry-forward block (3 deferred items from Phase 3) is already seeded; add the operator-facing motivation (CLI is the third operator surface, Phase 4 closes parity with web + channels). Then start step 4.1: verify `factory cancel <directive-id>` works against a real factoryd (Phase 2's plumbing + DB-direct fallback already shipped — this is a smoke-only verification or a small fix). 4.2 (`factory budget set`) is the first feature step. Background processes still running from Phase 3: factoryd PID may have rotated; live URL via `factory ui-token`. Astro dev on `127.0.0.1:4321` (not load-bearing for Phase 4 work).

---

## Git state

- **Branch:** main
- **Last commit:** `<phase-3-close commit sha — runbook lag-by-1 expected>` — chore(phase-3): close phase 3, kick off phase 4
- **Uncommitted changes:** none (clean post phase-close commit; the 9th occurrence of the documented post-session-end self-reference lag-by-1 will land at next `/session-end`)
- **Last phase tag:** `phase-3-web-ui-closed` (annotated tag at the close commit) — supersedes `phase-2-channel-parity-closed`

---

## Open blockers

- None

---

## In-flight work

None — Phase 3 closed cleanly via `/phase-close`. Cursor moves to 4.1.

Carry-forward items outside the work cursor (none block 4.x):

- **Three deferred follow-ups from Phase 3** — captured in the new Phase 4 README's `## Why this phase exists` carry-forward block: (1) Pause primitive on directive detail (defer until workflow signal); (2) PageShell adoption + Dashboard `<style is:global>` migration (11-page structural sweep); (3) Brain-side `log.line` forwarder (selective pino-stream tap; ADR 0029 future-work item). None are Phase 4 acceptance dependencies — operator can choose to slot any of them into Phase 4 as a "loose-ends sweep" or carry into Phase 5.
- **Pre-3.5 baseline live-smoke (chat-page click-test)** is the one Phase 3 acceptance gate the user explicitly framed as "deferred follow-up, not a 3.x acceptance dependency" at /phase-close time — the chat page passes its 3.5 unit + integration coverage, and ADR 0029's six-event-type live-verification is closed. The 30-second click-test (open `/app/chat`, type a question, see streamed reply) can land any time — natural fit during Phase 4 if the operator wants a quick visual check while testing CLI commands against a live daemon.
- **Smoke residue accumulated** from prior sessions: two projects (`node-sse-smoke` id `01KQWT6T6STXT4BFB5MC9QF9E6`; `smoke-demo` id `01KQW30T5274QGSEHHVZTRQ953`) at `C:\Users\Momo\factory5-workspace\<name>\`; 3 cancelled directives + 1 build directive in DB. Optional cleanup via `cd packages/state && node smoke-cleanup.mjs` + workspace dir removal. Not blocking — but Phase 4's `factory project delete --purge` (step 4.3) is the right tool to clean this up once it ships.
- **Filter-form Apply buttons + "Clear all defaults"** still render as user-agent default `<button>` on five sites (`pages/spend/index.astro:20`, `pages/findings/index.astro:40`, `pages/questions/index.astro:20`, `pages/directives/index.astro:24`, `pages/projects/detail.astro:64`). The deferred PageShell + `<style is:global>` migration absorbs all five — self-contained ~1 commit when authored.
- **Inline `style=` attributes** scattered across pages (e.g., `pages/projects/detail.astro:14-30`, chart titles in `pages/spend/index.astro`) — same PageShell migration absorbs these.
- **Control framework repo** (`G:\Projects\Small-Projects\Control`) still has uncommitted upstream patches matching local `e5ec723`. Operator owns the go for 2.2.2 → 2.2.3 publish.
- **`/session-end` skill structural fix** for the "Last commit" lag-by-1 self-reference drift remains unaddressed across 8 occurrences (the 9th lands at next session-end). Two structural options unchanged: track "last work commit" rather than HEAD, or amend STATE.md post-commit. Worth filing as ergonomic infrastructure work in a quiet Phase 4 session.

---

## Test / eval status

- **Last test run:** 2026-05-06 (phase-close verification) — full workspace passes, all four `pnpm` gates green: build / test / lint / format:check. Per-package counts unchanged from end-of-Phase-3 baseline: state 157, channels 175, daemon 173, brain 101, worker 38, worker-sandbox 86 + 3 skipped, assessor 79, wiki 74, cli 78, providers 39, ipc 28, events 3, core 14, logger 20, worker-mcp 15. **Workspace total 1080 passing + 3 skipped**.
- **Eval score** (agent phases only): n/a
- **Regression tests:** unit + integration only; no eval harness. ADR 0029 promoted past gated state at `/phase-close` — the unit-test-only carve-out for `finding.created` was retired; all six event types now confirmed live end-to-end (4 from 2026-05-05 prior-session smokes + cancel round-trip + 3.7's `node-sse-smoke` build's F001).

---

## Recent decisions (last 3 ADRs)

- **ADR 0029 — directive-stream-protocol** (Accepted 2026-05-05; promoted past gated state 2026-05-06 at `/phase-close`) — Live verification carve-out retired. Six event types confirmed live end-to-end.
- **ADR 0028 — worker-sandbox-contract** (per-spawn fs scoping; three Claude-Code-native primitives layered per-spawn)
- **ADR 0027 — web-ui-mutation-surface** (`POST /api/v1/builds`, `POST /api/v1/pending-questions/:id/answer`, `PUT /api/v1/projects/:id/budget`)

---

## Recently completed (last 5 steps)

- Phase 3 close — `chore(phase-3)`: close phase 3, kick off phase 4. Tagged `phase-3-web-ui-closed` at the close commit. Resolved issues U006, U007, U008, U009, U010, U022 in `UPGRADE/ISSUES.md` with full Resolution lines pointing at the closing commit per step. Promoted ADR 0029 past gated state — Live verification table shows ✅ for all six event types; the `finding.created` caveat paragraph and `finding.created live verification gap` Negative-consequence bullet retired; future-work list trimmed to active items. Phase 3 README's Deferred section populated with three carry-forward items + ADRs decided section filled in (0027 / 0028 / 0029). Phase 4 scaffolded at `.control/phases/phase-4-cli-completion/{README.md,steps.md}` with goal / outcome / sub-step list filled from `phase-plan.md` Phase 4 entry + tier-4 plan; carry-forward block seeded into Phase 4 README's "Why this phase exists". STATE.md → Phase 4. — 2026-05-06 — `<close-commit-sha>`
- Step 3.10 close — `refactor(3.10)`: close step 3.10 — logout + connection pip live. Flipped `[x] 3.10` in `phase-3-web-ui/steps.md` and ROADMAP. — 2026-05-05 — `80b9bec`
- Step 3.10 fix — `fix(3.10)`: surface stale-token case + name the recovery command. Operator smoke surfaced the gap: post-daemon-restart, the page's stored bearer goes stale; the heartbeat's generic 3-failure cycle was misleading because polling can't recover from 401. Short-circuit on 401 to red `disconnected` with terse "Session expired" label + verbose hover tooltip naming `factory ui-token`. ONBOARDING.md §6 troubleshooting entry extended. — 2026-05-05 — `3cecb72`
- Step 3.10 feat — `feat(3.10)`: explicit logout + connection-status pip in header. Layout-level heartbeat (30 s poll on `/api/v1/status`) drives a colored pip + dual logout buttons. State machine green/amber/red with theme-independent colors; logged-out banner unhides on `?logged-out=1`. — 2026-05-05 — `d544192`
- Step 3.9 close — `refactor(3.9)`: close step 3.9 — mobile-responsive nav live. Flipped `[x] 3.9` + ROADMAP tick. — 2026-05-05 — `8364e75`

---

## Attempts that didn't work (current step only)

- None — `/phase-close` ran cleanly. Cleared on phase boundary.

Worth recording from /phase-close itself for future reference: the verification-stage discovery that issues U006-U010 + U022 were still in the ISSUES.md "Open" section (not yet moved to "Resolved") at phase-close time. Fixed in the close commit by moving them with full Resolution lines per the format precedent set by Tier 1's resolved issues. The lesson: marking issues resolved is a phase-close-time done-criterion best done as the issues complete in their respective sub-step close commits, but folding into the phase-close commit is acceptable if the sub-step closes don't address it. Either is structurally fine — just don't lose track.

---

## Environment snapshot

- **Language / runtime:** TypeScript on Node 20+ (currently running Node 22.22.2)
- **Key pinned deps:** pnpm 9.12.0, tsup 8.5.1, vitest 2.1.9, prettier 3.8.3, eslint 9.39.4, better-sqlite3 (workspace), discord.js v14, grammy, fastify (workspace), Astro 5.x, Commander
- **Model in use:** Claude Code (claude-opus-4-7[1m])
- **Other:** Windows Server 2025 host
- **Background processes still running:** `factoryd` on `127.0.0.1:25295` may have rotated PIDs; not load-bearing for Phase 4. Get live URL via `factory ui-token`. `astro dev` on `127.0.0.1:4321` — not used by Phase 4 (CLI-only work). Stop both at session start if you want a clean slate (`factory daemon stop` + Ctrl-C the dev server in its terminal).

---

## Notes for next session

Phase 3 is **closed** (tag `phase-3-web-ui-closed`). Phase 4 (cli-completion) is the active phase — small but high-leverage tier estimated at ~1 session.

**Step 4.1 — Verify `factory cancel` (recommended start):**

Phase 2 step 2.4 shipped the brain hook + IPC route + DB-direct fallback. The CLI surface (`factory cancel <directive-id> [--reason <text>]`) was wired then; this Phase 4 step is the verification commit. If everything works as expected against a real factoryd, this might be a no-op or a tiny doc tweak. If something needs a fix (e.g., exit codes or `--reason` handling), land it as `fix(4.1): factory cancel — <issue>`.

**Phase 4 sub-step roadmap:**

1. **4.1** — Verify `factory cancel` end-to-end (smoke, possibly no-op).
2. **4.2** — `factory budget set <project>` reusing wiki helpers; same code path as `PUT /api/v1/projects/:id/budget`.
3. **4.3** — `factory project list / show / delete` (with `--purge` for explicit destructive variant).
4. **4.4** — `factory ask "<question>"` single-shot chat (`--json` for scripting); reuses chat.ts via extracted `submitOneDirective` helper.
5. **4.5** — Tab completion via `factory completion <shell>` (bash/zsh/pwsh, static).
6. **4.6** — Rich `--help` examples via `addHelpText('after', '...')` on every command.
7. **4.7** — `packages/cli/README.md` refresh.
8. **4.8** — Resolve issues U018, U019, U020, U021 in `UPGRADE/ISSUES.md` + tick Tier 4 boxes in `UPGRADE/ROADMAP.md`.
9. **4.9** — `/phase-close`.

Full plan + sub-task detail in [`../../UPGRADE/plans/tier-4-cli-completion.md`](../../UPGRADE/plans/tier-4-cli-completion.md).

**Pre-kickoff README edits the operator should make:**

The Phase 4 README has two `<Fill in during phase kickoff.>` placeholders:
- `## Where we were, end of Phase 3` — terse summary of the 10-step Phase 3 arc.
- `## Why this phase exists` — the carry-forward block (3 deferred items) is already seeded; add the operator-facing motivation paragraph (e.g., "CLI is the third operator surface; Phase 4 closes parity with web + channels — `cancel`, budget mutation, project introspection, single-shot chat, plus the polish — tab completion + worked help examples").

These are conventionally filled at the start of the first Phase 4 sub-step session.

**Carry-forward items (none block 4.x):** Pause primitive (defer-until-signal); PageShell + `<style is:global>` migration (1-commit sweep, available any time); brain-side `log.line` forwarder (ADR 0029 future-work; not gating); chat-page click-test (Phase 3 deferred follow-up — natural fit during Phase 4 visual checks); Control framework repo 2.2.3 publish (operator's go); `/session-end` skill lag-by-1 fix (8 occurrences; ergonomic).

Read [`../../UPGRADE/LOG.md`](../../UPGRADE/LOG.md) for the upgrade-side narrative across sessions; this STATE.md is the operational cursor (overwritten at each `/session-end`).

**Frontend-design judgement calls carried from Phase 3** (worth recalling for any Phase 4 web-side work, even though Phase 4 is CLI-only):

- Smart defaults read better than empty states.
- Native HTML beats custom widgets when semantics align.
- Theme-independent intentional colors for status semantics (traffic-light pip).
- Error-class differentiation matters when recovery paths differ.
- Visible-label vs. hover-title separation.
- Inherit-don't-invent; root-cause CSS fixes over global rewrites; hint-copy-teaches-consequence; in-context-affordance-vs-nav.
